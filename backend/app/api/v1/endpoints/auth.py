from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.permissions import get_permissions_for_role
from app.auth.security import (
    create_access_token,
    verify_password,
)
from app.db import get_db
from app.models.user import User

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    id: UUID
    username: str
    role: str
    permissions: list[str]


def _get_user_by_username(db: Session, username: str) -> Optional[User]:
    return db.query(User).filter(User.username == username).one_or_none()


@router.post("/login", response_model=TokenResponse, summary="Login")
async def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = _get_user_by_username(db, payload.username)
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token({"sub": str(user.id), "role": user.role})
    return TokenResponse(access_token=token)


@router.get("/me", response_model=MeResponse, summary="Current user")
async def me(current_user: User = Depends(get_current_user)):
    return MeResponse(
        id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        permissions=get_permissions_for_role(current_user.role),
    )
