from __future__ import annotations

from datetime import datetime
import re
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.auth.deps import require_any_permission, require_permission
from app.auth.permissions import ROLE_PERMISSIONS
from app.services.audit_service import (
    ACTION_CREATE,
    ACTION_DELETE,
    ACTION_UPDATE,
    get_client_ip,
    log_action,
)
from app.auth.security import get_password_hash
from app.db import get_db
from app.models.user import User

router = APIRouter()

VALID_ROLES = set(ROLE_PERMISSIONS.keys())


def _validate_password(password: str) -> None:
    """
    Simplified password validation for internal warehouse users.
    Minimum 6 characters - easy to remember for operators.
    """
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")


class UserOut(BaseModel):
    id: UUID
    username: str
    full_name: Optional[str] = None
    role: str
    is_active: bool
    created_at: datetime
    last_login_at: Optional[datetime] = None


class UserListOut(BaseModel):
    items: list[UserOut]
    total: int
    limit: int
    offset: int


class UserCreateIn(BaseModel):
    username: str = Field(..., min_length=3, max_length=128)
    full_name: Optional[str] = Field(default=None, max_length=255)
    password: str = Field(..., min_length=6)
    role: str
    is_active: bool = True


class UserUpdateIn(BaseModel):
    username: Optional[str] = Field(default=None, min_length=3, max_length=128)
    full_name: Optional[str] = Field(default=None, max_length=255)
    role: Optional[str] = None
    is_active: Optional[bool] = None


class ResetPasswordIn(BaseModel):
    new_password: str = Field(..., min_length=6)


def _to_user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


@router.get("", response_model=UserListOut, summary="List users")
@router.get("/", response_model=UserListOut, summary="List users")
async def list_users(
    q: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["users:read", "users:manage"])),
):
    query = db.query(User)
    if q:
        term = f"%{q.strip()}%"
        query = query.filter(or_(User.username.ilike(term), User.full_name.ilike(term)))

    total = query.with_entities(func.count(User.id)).scalar() or 0
    items = query.order_by(User.created_at.desc()).offset(offset).limit(limit).all()

    return UserListOut(
        items=[_to_user_out(user) for user in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{user_id}", response_model=UserOut, summary="Get user")
async def get_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["users:read", "users:manage"])),
):
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _to_user_out(user)


@router.post("", response_model=UserOut, summary="Create user", status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=UserOut, summary="Create user", status_code=status.HTTP_201_CREATED)
async def create_user(
    request: Request,
    payload: UserCreateIn,
    db: Session = Depends(get_db),
    user=Depends(require_permission("users:manage")),
):
    if payload.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")

    _validate_password(payload.password)

    existing = db.query(User).filter(User.username == payload.username).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    new_user = User(
        username=payload.username,
        full_name=payload.full_name,
        password_hash=get_password_hash(payload.password),
        role=payload.role,
        is_active=payload.is_active,
    )
    db.add(new_user)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_CREATE,
        entity_type="user",
        entity_id=str(new_user.id),
        new_data={"username": payload.username, "role": payload.role, "is_active": payload.is_active},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(new_user)
    return _to_user_out(new_user)


@router.patch("/{user_id}", response_model=UserOut, summary="Update user")
async def update_user(
    request: Request,
    user_id: UUID,
    payload: UserUpdateIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("users:manage")),
):
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    old_data = {"username": user.username, "role": user.role, "is_active": user.is_active}
    updates = payload.dict(exclude_unset=True)
    if "role" in updates and updates["role"] not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    if "username" in updates:
        new_username = updates["username"].strip() if updates["username"] else None
        if new_username and new_username != user.username:
            existing = db.query(User).filter(User.username == new_username).one_or_none()
            if existing:
                raise HTTPException(status_code=409, detail="Username already exists")
            user.username = new_username

    if "full_name" in updates:
        user.full_name = updates["full_name"]
    if "role" in updates:
        user.role = updates["role"]
    if "is_active" in updates:
        user.is_active = updates["is_active"]

    new_data = {"username": user.username, "role": user.role, "is_active": user.is_active}
    log_action(
        db,
        user_id=current_user.id,
        action=ACTION_UPDATE,
        entity_type="user",
        entity_id=str(user_id),
        old_data=old_data,
        new_data=new_data,
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(user)
    return _to_user_out(user)


@router.post("/{user_id}/reset-password", summary="Reset password")
async def reset_password(
    request: Request,
    user_id: UUID,
    payload: ResetPasswordIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("users:manage")),
):
    _validate_password(payload.new_password)
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = get_password_hash(payload.new_password)
    log_action(
        db,
        user_id=current_user.id,
        action=ACTION_UPDATE,
        entity_type="user",
        entity_id=str(user_id),
        old_data={},
        new_data={"action": "password_reset"},
        ip_address=get_client_ip(request),
    )
    db.commit()
    return {"status": "ok"}


@router.delete("/{user_id}", response_model=UserOut, summary="Disable user")
async def disable_user(
    request: Request,
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("users:manage")),
):
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    old_data = {"username": user.username, "is_active": user.is_active}
    user.is_active = False
    log_action(
        db,
        user_id=current_user.id,
        action=ACTION_UPDATE,
        entity_type="user",
        entity_id=str(user_id),
        old_data=old_data,
        new_data={**old_data, "is_active": False},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(user)
    return _to_user_out(user)
