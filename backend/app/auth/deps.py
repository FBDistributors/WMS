from __future__ import annotations

from collections.abc import Callable
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.permissions import get_permissions_for_role
from app.auth.security import decode_token
from app.db import get_db
from app.models.user import User
from app.models.user_session import UserSession

security = HTTPBearer(auto_error=False)


def get_current_user(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    token = credentials.credentials
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive user")

    # Session validation: token must exist in user_sessions (admin up to 3, others 1)
    session = (
        db.query(UserSession)
        .filter(UserSession.user_id == user.id, UserSession.token == token)
        .first()
    )
    if not session:
        # Backward compat: allow old single-token sessions until next login
        if user.active_session_token and user.active_session_token == token:
            pass
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired or logged in from another device",
            )

    return user


def get_effective_permissions(user: User) -> set[str]:
    """Role permissions + per-user granted_permissions."""
    role_perms = set(get_permissions_for_role(user.role))
    extra = getattr(user, "granted_permissions", None) or []
    return role_perms | set(extra)


def require_permission(permission: str) -> Callable[[User], User]:
    def _guard(user: User = Depends(get_current_user)) -> User:
        permissions = get_effective_permissions(user)
        if permission not in permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return _guard


def require_any_permission(permissions: list[str]) -> Callable[[User], User]:
    def _guard(user: User = Depends(get_current_user)) -> User:
        granted = get_effective_permissions(user)
        if not any(permission in granted for permission in permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return _guard


def require_admin_access() -> Callable[[User], User]:
    return require_permission("admin:access")


def require_role(allowed_roles: list[str]) -> Callable[[User], User]:
    """Fast path: allow only these roles (e.g. block picker from admin routes)."""

    def _guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role",
            )
        return user

    return _guard
