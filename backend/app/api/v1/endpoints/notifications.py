"""Admin / settings: push notification diagnostics and test send."""
from __future__ import annotations

import os
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.models.user import User
from app.models.user_fcm_token import UserFCMToken
from app.services.push_notifications import send_push_to_user

router = APIRouter()


def _fcm_credentials_configured() -> bool:
    try:
        import firebase_admin
    except ImportError:
        return False
    if firebase_admin._apps:
        return True
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    return bool(cred_path and os.path.isfile(cred_path))


class PushStatusResponse(BaseModel):
    fcm_server_configured: bool
    registered_devices_for_current_user: int


@router.get("/push-status", response_model=PushStatusResponse, summary="FCM readiness and device token count")
def get_push_status(
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("admin:access")),
) -> PushStatusResponse:
    n = db.query(UserFCMToken).filter(UserFCMToken.user_id == user.id).count()
    return PushStatusResponse(
        fcm_server_configured=_fcm_credentials_configured(),
        registered_devices_for_current_user=int(n),
    )


class TestSelfPushResponse(BaseModel):
    sent: bool


@router.post(
    "/test-self",
    response_model=TestSelfPushResponse,
    summary="Send a test FCM notification to the current user's devices",
)
def post_test_self_push(
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("admin:access")),
) -> TestSelfPushResponse:
    sent = send_push_to_user(
        db,
        user.id,
        "WMS test",
        "Agar mobil ilovada ruxsat berilgan bo‘lsa, bildirishnoma chiqishi kerak.",
        data={"type": "admin_test"},
    )
    return TestSelfPushResponse(sent=sent)
