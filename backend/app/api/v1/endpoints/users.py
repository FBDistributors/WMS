from __future__ import annotations

from datetime import datetime
import re
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.auth.permissions import ROLE_PERMISSIONS
from app.auth.security import get_password_hash
from app.db import get_db
from app.models.user import User

router = APIRouter()

VALID_ROLES = set(ROLE_PERMISSIONS.keys())


def _validate_password(password: str) -> None:
    if len(password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters.")
    if not re.search(r"[A-Z]", password):
        raise HTTPException(status_code=400, detail="Password must include an uppercase letter.")
    if not re.search(r"[a-z]", password):
        raise HTTPException(status_code=400, detail="Password must include a lowercase letter.")
    if not re.search(r"[0-9]", password):
        raise HTTPException(status_code=400, detail="Password must include a digit.")
    if not re.search(r"[^A-Za-z0-9]", password):
        raise HTTPException(status_code=400, detail="Password must include a symbol.")


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
    password: str = Field(..., min_length=12)
    role: str
    is_active: bool = True


class UserUpdateIn(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=255)
    role: Optional[str] = None
    is_active: Optional[bool] = None


class ResetPasswordIn(BaseModel):
    new_password: str = Field(..., min_length=12)


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
    _user=Depends(require_permission("users:manage")),
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
    _user=Depends(require_permission("users:manage")),
):
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _to_user_out(user)


@router.post("", response_model=UserOut, summary="Create user", status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=UserOut, summary="Create user", status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreateIn,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("users:manage")),
):
    if payload.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")

    _validate_password(payload.password)

    existing = db.query(User).filter(User.username == payload.username).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    user = User(
        username=payload.username,
        full_name=payload.full_name,
        password_hash=get_password_hash(payload.password),
        role=payload.role,
        is_active=payload.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_user_out(user)


@router.patch("/{user_id}", response_model=UserOut, summary="Update user")
async def update_user(
    user_id: UUID,
    payload: UserUpdateIn,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("users:manage")),
):
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    updates = payload.dict(exclude_unset=True)
    if "role" in updates and updates["role"] not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")

    if "full_name" in updates:
        user.full_name = updates["full_name"]
    if "role" in updates:
        user.role = updates["role"]
    if "is_active" in updates:
        user.is_active = updates["is_active"]

    db.commit()
    db.refresh(user)
    return _to_user_out(user)


@router.post("/{user_id}/reset-password", summary="Reset password")
async def reset_password(
    user_id: UUID,
    payload: ResetPasswordIn,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("users:manage")),
):
    _validate_password(payload.new_password)
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = get_password_hash(payload.new_password)
    db.commit()
    return {"status": "ok"}


@router.delete("/{user_id}", response_model=UserOut, summary="Disable user")
async def disable_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("users:manage")),
):
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    db.commit()
    db.refresh(user)
    return _to_user_out(user)
