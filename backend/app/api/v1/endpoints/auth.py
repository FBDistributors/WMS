import logging
import time
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, get_effective_permissions
from app.auth.security import (
    create_access_token,
    get_password_hash,
    verify_password,
)
from app.db import get_db
from app.models.user import User
from app.models.user_session import UserSession

logger = logging.getLogger(__name__)
router = APIRouter()

ADMIN_ROLE = "warehouse_admin"
MAX_ADMIN_SESSIONS = 5
# Picker/controller: 2 sessiya (mobil + bitta boshqa), shunda buyurtmaga kirganda avtomat chiqmasin
MAX_OTHER_SESSIONS = 2

# Login rate-limiting: oynada N ta noto'g'ri urinishdan keyin vaqtincha bloklash.
# In-memory (har worker alohida hisoblaydi) — brute-force'ni amalda to'sish uchun yetarli.
LOGIN_MAX_FAILED_ATTEMPTS = 5
LOGIN_ATTEMPT_WINDOW_SECONDS = 600
LOGIN_LOCKOUT_SECONDS = 600
# key -> list of failed attempt timestamps (monotonic emas, time.time)
_failed_login_attempts: dict[str, list[float]] = {}


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for") or ""
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _login_rate_key(username: str, request: Request) -> str:
    return f"{username.strip().lower()}|{_client_ip(request)}"


def _prune_login_attempts(now: float) -> None:
    cutoff = now - max(LOGIN_ATTEMPT_WINDOW_SECONDS, LOGIN_LOCKOUT_SECONDS)
    stale_keys = [k for k, ts in _failed_login_attempts.items() if not ts or ts[-1] < cutoff]
    for k in stale_keys:
        _failed_login_attempts.pop(k, None)


def _check_login_rate_limit(key: str) -> None:
    """429 agar oynada juda ko'p noto'g'ri urinish bo'lgan bo'lsa."""
    now = time.time()
    _prune_login_attempts(now)
    attempts = _failed_login_attempts.get(key, [])
    recent = [t for t in attempts if t > now - LOGIN_ATTEMPT_WINDOW_SECONDS]
    if len(recent) >= LOGIN_MAX_FAILED_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Juda ko'p urinish. Keyinroq qayta urinib ko'ring.",
        )


def _record_failed_login(key: str) -> None:
    now = time.time()
    attempts = _failed_login_attempts.setdefault(key, [])
    attempts.append(now)
    # Faqat so'nggi oynadagi urinishlarni saqlaymiz
    _failed_login_attempts[key] = [
        t for t in attempts if t > now - max(LOGIN_ATTEMPT_WINDOW_SECONDS, LOGIN_LOCKOUT_SECONDS)
    ]


def _clear_failed_logins(key: str) -> None:
    _failed_login_attempts.pop(key, None)


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


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdateMeRequest(BaseModel):
    username: Optional[str] = None
    full_name: Optional[str] = None


ADMIN_MIN_PASSWORD_LENGTH = 10


def _validate_password(password: str, role: str | None = None) -> None:
    if role == ADMIN_ROLE:
        if len(password) < ADMIN_MIN_PASSWORD_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Admin password must be at least {ADMIN_MIN_PASSWORD_LENGTH} characters.",
            )
        return
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")


def _get_user_by_username(db: Session, username: str) -> Optional[User]:
    return db.query(User).filter(User.username == username).one_or_none()


@router.post("/login", response_model=TokenResponse, summary="Login")
async def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    rate_key = _login_rate_key(payload.username, request)
    _check_login_rate_limit(rate_key)
    try:
        user = _get_user_by_username(db, payload.username)
        if not user or not verify_password(payload.password, user.password_hash):
            _record_failed_login(rate_key)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        _clear_failed_logins(rate_key)
        token = create_access_token({"sub": str(user.id), "role": user.role})
        user_agent = (request.headers.get("user-agent") or "Unknown")[:500]
        user.last_login_at = datetime.utcnow()
        user.last_device_info = user_agent

        existing = (
            db.query(UserSession)
            .filter(UserSession.user_id == user.id)
            .order_by(UserSession.created_at.asc())
            .all()
        )
        if user.username and user.username.strip().lower() == "test":
            max_sessions = 999
        else:
            max_sessions = MAX_ADMIN_SESSIONS if user.role == ADMIN_ROLE else MAX_OTHER_SESSIONS

        while len(existing) >= max_sessions and existing:
            db.delete(existing.pop(0))

        db.add(UserSession(user_id=user.id, token=token, device_info=user_agent))
        db.commit()
        return TokenResponse(access_token=token)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("login endpoint error")
        raise HTTPException(status_code=500, detail="Internal error") from e


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


@router.post("/change-password", summary="Change current user password")
async def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid current password")
    _validate_password(payload.new_password, role=current_user.role)
    current_user.password_hash = get_password_hash(payload.new_password)
    db.commit()
    return {"status": "ok"}


@router.patch("/me", response_model=MeResponse, summary="Update current user profile")
async def update_me(
    payload: UpdateMeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.username is not None:
        username = payload.username.strip()
        if len(username) < 3:
            raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
        if username != current_user.username:
            existing = _get_user_by_username(db, username)
            if existing:
                raise HTTPException(status_code=409, detail="Username already exists")
            current_user.username = username
    if payload.full_name is not None:
        current_user.full_name = payload.full_name.strip() or None
    db.commit()
    db.refresh(current_user)
    return MeResponse(
        id=current_user.id,
        username=current_user.username,
        full_name=current_user.full_name,
        role=current_user.role,
        permissions=list(get_effective_permissions(current_user)),
    )
