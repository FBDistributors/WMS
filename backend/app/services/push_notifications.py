"""Push notifications via Firebase Cloud Messaging (FCM)."""
from __future__ import annotations

import logging
import os
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.user_fcm_token import UserFCMToken

logger = logging.getLogger(__name__)


def get_fcm_tokens_for_user(db: Session, user_id: UUID) -> list[str]:
    """Return list of FCM tokens registered for the user."""
    rows = db.query(UserFCMToken.token).filter(UserFCMToken.user_id == user_id).all()
    return [r.token for r in rows if r.token]


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
    Requires firebase-admin and GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_CREDENTIALS_JSON path).
    """
    tokens = get_fcm_tokens_for_user(db, user_id)
    if not tokens:
        logger.info("No FCM tokens for user %s, skip push", user_id)
        return False

    try:
        import firebase_admin
        from firebase_admin import messaging
    except ImportError:
        logger.warning("firebase-admin not installed, push notifications disabled")
        return False

    if not firebase_admin._apps:
        cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if not cred_path or not os.path.isfile(cred_path):
            logger.warning("GOOGLE_APPLICATION_CREDENTIALS not set or file missing, push disabled")
            return False
        firebase_admin.initialize_app()

    success = False
    for token in tokens:
        try:
            messaging.send(
                messaging.Message(
                    notification=messaging.Notification(title=title, body=body),
                    data=data or {},
                    token=token,
                    android=messaging.AndroidConfig(
                        priority="high",
                        notification=messaging.AndroidNotification(sound="default"),
                    ),
                )
            )
            success = True
        except Exception as e:
            logger.warning("FCM send failed for token %s...: %s", token[:20], e)
    return success
