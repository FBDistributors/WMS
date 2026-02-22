from typing import Optional
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, get_effective_permissions
from app.auth.security import (
    create_access_token,
    verify_password,
)
from app.db import get_db
from app.models.user import User
from app.models.user_session import UserSession

router = APIRouter()

ADMIN_ROLE = "warehouse_admin"
MAX_ADMIN_SESSIONS = 3
MAX_OTHER_SESSIONS = 1


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    id: UUID
    username: str
    full_name: Optional[str] = None
    role: str
    permissions: list[str]


def _get_user_by_username(db: Session, username: str) -> Optional[User]:
    return db.query(User).filter(User.username == username).one_or_none()


@router.post("/login", response_model=TokenResponse, summary="Login")
async def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = _get_user_by_username(db, payload.username)
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token({"sub": str(user.id), "role": user.role})
    user_agent = (request.headers.get("user-agent") or "Unknown")[:500]
    user.last_login_at = datetime.utcnow()
    user.last_device_info = user_agent

    # Session limits: admin 3 devices, others 1 device
    existing = (
        db.query(UserSession)
        .filter(UserSession.user_id == user.id)
        .order_by(UserSession.created_at.asc())
        .all()
    )
    max_sessions = MAX_ADMIN_SESSIONS if user.role == ADMIN_ROLE else MAX_OTHER_SESSIONS

    if user.role == ADMIN_ROLE:
        # Admin: keep up to 3; remove oldest if at limit
        while len(existing) >= max_sessions and existing:
            db.delete(existing.pop(0))
    else:
        # Non-admin: single device — remove all previous sessions
        for s in existing:
            db.delete(s)

    db.add(UserSession(user_id=user.id, token=token, device_info=user_agent))
    db.commit()
    return TokenResponse(access_token=token)


@router.post("/logout", summary="Logout")
async def logout(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove current session (token) from user_sessions."""
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        token = auth[7:]
        db.query(UserSession).filter(
            UserSession.user_id == current_user.id,
            UserSession.token == token,
        ).delete()
        # Clear legacy single-token field if this was the active one
        if current_user.active_session_token == token:
            current_user.active_session_token = None
            current_user.session_started_at = None
    db.commit()
    return {"status": "ok", "message": "Logged out successfully"}


@router.get("/me", response_model=MeResponse, summary="Current user")
async def me(current_user: User = Depends(get_current_user)):
    return MeResponse(
        id=current_user.id,
        username=current_user.username,
        full_name=current_user.full_name,
        role=current_user.role,
        permissions=list(get_effective_permissions(current_user)),
    )
