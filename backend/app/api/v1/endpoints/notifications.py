"""Admin / settings: push notification diagnostics and test send."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.models.user import User
from app.models.user_fcm_token import UserFCMToken
from app.services.push_notifications import (
    detect_fcm_credential_source,
    is_fcm_server_configured,
    send_push_broadcast,
    send_push_to_user,
)

router = APIRouter()


class PushStatusResponse(BaseModel):
    fcm_server_configured: bool
    fcm_credential_source: str
    registered_devices_for_current_user: int
    total_fcm_tokens_all_users: int


@router.get("/push-status", response_model=PushStatusResponse, summary="FCM readiness and device token count")
def get_push_status(
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("admin:access")),
) -> PushStatusResponse:
    n = db.query(UserFCMToken).filter(UserFCMToken.user_id == user.id).count()
    total_all = db.query(UserFCMToken).count()
    return PushStatusResponse(
        fcm_server_configured=is_fcm_server_configured(),
        fcm_credential_source=detect_fcm_credential_source(),
        registered_devices_for_current_user=int(n),
        total_fcm_tokens_all_users=int(total_all),
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


class BroadcastPushRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=4000)


class BroadcastPushResponse(BaseModel):
    total_tokens: int
    success: int
    failed: int


@router.post(
    "/broadcast",
    response_model=BroadcastPushResponse,
    summary="Send FCM notification to all registered devices (all users)",
)
def post_broadcast_push(
    payload: BroadcastPushRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:access")),
) -> BroadcastPushResponse:
    total, ok, bad = send_push_broadcast(
        db,
        payload.title.strip(),
        payload.body.strip(),
        data={"type": "admin_broadcast"},
    )
    return BroadcastPushResponse(total_tokens=total, success=ok, failed=bad)


# Ilova Play Store sahifasi — bosilganda "Update" tugmasi shu yerda.
_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=uz.fbwarehouse.wms"


class AppUpdatePushRequest(BaseModel):
    # Ixtiyoriy: admin o'z matnini bersa; bo'sh bo'lsa standart matn ishlatiladi.
    title: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=4000)
    url: str = Field(default="", max_length=1000)


@router.post(
    "/app-update",
    response_model=BroadcastPushResponse,
    summary="Send an app-update notification (opens the Play Store page on tap)",
)
def post_app_update_push(
    payload: AppUpdatePushRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:access")),
) -> BroadcastPushResponse:
    title = payload.title.strip() or "Ilova yangilandi"
    body = (
        payload.body.strip()
        or "Yangi versiya chiqdi. Yangilash uchun bosing."
    )
    url = payload.url.strip() or _PLAY_STORE_URL
    total, ok, bad = send_push_broadcast(
        db,
        title,
        body,
        data={"type": "app_update", "url": url},
    )
    return BroadcastPushResponse(total_tokens=total, success=ok, failed=bad)
