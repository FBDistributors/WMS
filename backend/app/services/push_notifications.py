"""Push notifications via Firebase Cloud Messaging (FCM)."""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.user_fcm_token import UserFCMToken

logger = logging.getLogger(__name__)

# VPS server: FCM service account JSON ni /etc/wms/api.env yoki backend/.env ga qo'ying (fayl yo'li qulay emas bo'lsa).
# Keep aliases for easier migration from older environment naming.
_ENV_JSON_KEYS = (
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "FIREBASE_SERVICE_ACCOUNT",
    "FIREBASE_CREDENTIALS_JSON",
)
_ENV_JSON_B64_KEYS = (
    "FIREBASE_SERVICE_ACCOUNT_JSON_B64",
    "FIREBASE_SERVICE_ACCOUNT_B64",
    "FIREBASE_CREDENTIALS_JSON_B64",
)
_GOOGLE_CRED_PATH_KEYS = (
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_APPLICATION_CREDENTIALS_PATH",
)


def _read_env(*keys: str) -> tuple[str, str]:
    """Return first non-empty env value + key name."""
    for key in keys:
        value = os.environ.get(key, "").strip()
        if value:
            return key, value
    return "", ""


def _load_service_account_dict() -> dict[str, Any] | None:
    b64_key, b64 = _read_env(*_ENV_JSON_B64_KEYS)
    if b64:
        try:
            raw = base64.standard_b64decode(b64)
            obj = json.loads(raw.decode("utf-8"))
            return obj if isinstance(obj, dict) else None
        except (ValueError, json.JSONDecodeError, OSError) as e:
            logger.warning("Invalid %s: %s", b64_key, e)
            return None
    json_key, raw = _read_env(*_ENV_JSON_KEYS)
    if not raw:
        return None
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError as e:
        logger.warning("Invalid %s: %s", json_key, e)
        return None


def _looks_like_service_account(info: dict[str, Any]) -> bool:
    return info.get("type") == "service_account" and bool(info.get("private_key"))


def _credential_path_exists() -> bool:
    _key, path = _read_env(*_GOOGLE_CRED_PATH_KEYS)
    return bool(path and os.path.isfile(path))


def detect_fcm_credential_source() -> str:
    """Human-readable source used to configure Firebase credentials."""
    b64_key, b64 = _read_env(*_ENV_JSON_B64_KEYS)
    if b64:
        return b64_key
    json_key, raw = _read_env(*_ENV_JSON_KEYS)
    if raw:
        return json_key
    path_key, path = _read_env(*_GOOGLE_CRED_PATH_KEYS)
    if path and os.path.isfile(path):
        return path_key
    return "none"


def is_fcm_server_configured() -> bool:
    """True if firebase-admin is present and credentials are available (not yet initialized)."""
    try:
        import firebase_admin
    except ImportError:
        return False
    if firebase_admin._apps:
        return True
    data = _load_service_account_dict()
    if data and _looks_like_service_account(data):
        return True
    return _credential_path_exists()


def ensure_firebase_app() -> bool:
    """Initialize firebase_admin once. Returns False if credentials missing or init fails."""
    try:
        import firebase_admin
        from firebase_admin import credentials
    except ImportError:
        return False
    if firebase_admin._apps:
        return True
    data = _load_service_account_dict()
    if data and _looks_like_service_account(data):
        try:
            firebase_admin.initialize_app(credentials.Certificate(data))
            return True
        except Exception as e:
            logger.warning("Firebase init from env JSON failed: %s", e)
            return False
    if _credential_path_exists():
        try:
            firebase_admin.initialize_app()
            return True
        except Exception as e:
            logger.warning("Firebase init from GOOGLE_APPLICATION_CREDENTIALS failed: %s", e)
            return False
    return False

# Android 8+ channel id; Flutter `flutter_local_notifications` creates the same channel for foreground banners.
FCM_ANDROID_CHANNEL_ID = "wms_picking"


def _fcm_data_as_strings(data: dict[str, str] | None) -> dict[str, str]:
    """FCM `data` map values must be strings."""
    if not data:
        return {}
    out: dict[str, str] = {}
    for k, v in data.items():
        out[str(k)] = v if isinstance(v, str) else str(v)
    return out


def get_fcm_tokens_for_user(db: Session, user_id: UUID) -> list[str]:
    """Return list of FCM tokens registered for the user."""
    rows = db.query(UserFCMToken.token).filter(UserFCMToken.user_id == user_id).all()
    return [r.token for r in rows if r.token]


def get_all_fcm_tokens(db: Session) -> list[str]:
    """Every registered device token (all users) for broadcast."""
    rows = db.query(UserFCMToken.token).all()
    return [r.token for r in rows if r.token]


def _fcm_message_for_token(
    token: str,
    title: str,
    body: str,
    data_payload: dict[str, str],
):
    from firebase_admin import messaging

    return messaging.Message(
        notification=messaging.Notification(title=title, body=body),
        data=data_payload,
        token=token,
        android=messaging.AndroidConfig(
            priority="high",
            notification=messaging.AndroidNotification(
                sound="default",
                channel_id=FCM_ANDROID_CHANNEL_ID,
            ),
        ),
        apns=messaging.APNSConfig(
            payload=messaging.APNSPayload(aps=messaging.Aps(sound="default")),
        ),
    )


def send_push_broadcast(
    db: Session,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> tuple[int, int, int]:
    """
    Send one notification to every stored FCM token (all users / devices).
    Returns (total_tokens, success_count, failure_count).
    """
    tokens = get_all_fcm_tokens(db)
    total = len(tokens)
    if total == 0:
        return 0, 0, 0

    try:
        from firebase_admin import messaging
    except ImportError:
        logger.warning("firebase-admin not installed, push broadcast skipped")
        return total, 0, total

    if not ensure_firebase_app():
        logger.warning("Firebase credentials not configured, push broadcast skipped")
        return total, 0, total

    data_payload = _fcm_data_as_strings(data)
    success = 0
    failure = 0
    # firebase_admin.messaging.send_each — batch internally; chunk to limit memory / request size
    batch_size = 500
    for i in range(0, total, batch_size):
        chunk = tokens[i : i + batch_size]
        messages = [_fcm_message_for_token(t, title, body, data_payload) for t in chunk]
        try:
            br = messaging.send_each(messages)
            success += br.success_count
            failure += br.failure_count
        except Exception as e:
            logger.warning("FCM broadcast batch failed: %s", e)
            failure += len(chunk)
    return total, success, failure


def send_push_to_user(
    db: Session,
    user_id: UUID,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> bool:
    """
    Send a push notification to all devices of the user.
    Returns True if at least one message was sent successfully.
    Requires firebase-admin and one of:
    FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_JSON_B64, or GOOGLE_APPLICATION_CREDENTIALS (file path).
    """
    tokens = get_fcm_tokens_for_user(db, user_id)
    if not tokens:
        logger.info("No FCM tokens for user %s, skip push", user_id)
        return False

    try:
        from firebase_admin import messaging
    except ImportError:
        logger.warning("firebase-admin not installed, push notifications disabled")
        return False

    if not ensure_firebase_app():
        logger.warning("Firebase credentials not configured, push disabled")
        return False

    data_payload = _fcm_data_as_strings(data)
    success = False
    for token in tokens:
        try:
            messaging.send(_fcm_message_for_token(token, title, body, data_payload))
            success = True
        except Exception as e:
            logger.warning("FCM send failed for token %s...: %s", token[:20], e)
    return success
