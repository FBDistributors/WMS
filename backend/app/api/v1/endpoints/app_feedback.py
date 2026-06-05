"""Mobile app internal feedback (1–5 stars + optional comment)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_permission
from app.db import get_db
from app.models.user import User
from app.models.user_app_feedback import UserAppFeedback

router = APIRouter()

VALID_ROLES = {"picker", "controller", "warehouse_admin", "supervisor", "inventory_controller"}
VALID_MODULES = {"picking", "returns", "inventory", "receiving", "general"}


class AppFeedbackCreateIn(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(default=None, max_length=500)
    role: str = Field(..., min_length=1, max_length=32)
    module: str = Field(..., min_length=1, max_length=32)
    context_ref: Optional[str] = Field(default=None, max_length=128)
    app_version: Optional[str] = Field(default=None, max_length=32)
    platform: Optional[str] = Field(default=None, max_length=32)


class AppFeedbackOut(BaseModel):
    id: UUID
    user_id: UUID
    username: Optional[str] = None
    full_name: Optional[str] = None
    rating: int
    comment: Optional[str] = None
    role: str
    module: str
    context_ref: Optional[str] = None
    app_version: Optional[str] = None
    platform: Optional[str] = None
    created_at: datetime


class AppFeedbackStatsOut(BaseModel):
    average_rating: Optional[float] = None
    picker_average: Optional[float] = None
    controller_average: Optional[float] = None
    total_count: int


class AppFeedbackListOut(BaseModel):
    items: List[AppFeedbackOut]
    total: int
    limit: int
    offset: int
    stats: AppFeedbackStatsOut


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def _apply_list_filters(
    query,
    *,
    role: Optional[str],
    module: Optional[str],
    rating: Optional[int],
    date_from: Optional[str],
    date_to: Optional[str],
):
    if role:
        query = query.filter(UserAppFeedback.role == role.strip())
    if module:
        query = query.filter(UserAppFeedback.module == module.strip())
    if rating is not None:
        query = query.filter(UserAppFeedback.rating == rating)
    d_from = _parse_date(date_from)
    if d_from is not None:
        query = query.filter(func.date(UserAppFeedback.created_at) >= d_from)
    d_to = _parse_date(date_to)
    if d_to is not None:
        query = query.filter(func.date(UserAppFeedback.created_at) <= d_to)
    return query


def _compute_stats(query) -> AppFeedbackStatsOut:
    total = query.with_entities(func.count(UserAppFeedback.id)).scalar() or 0
    if total == 0:
        return AppFeedbackStatsOut(total_count=0)

    avg_all = query.with_entities(func.avg(UserAppFeedback.rating)).scalar()
    picker_avg = (
        query.filter(UserAppFeedback.role == "picker")
        .with_entities(func.avg(UserAppFeedback.rating))
        .scalar()
    )
    controller_avg = (
        query.filter(UserAppFeedback.role == "controller")
        .with_entities(func.avg(UserAppFeedback.rating))
        .scalar()
    )

    def _round(v) -> Optional[float]:
        if v is None:
            return None
        return round(float(v), 2)

    return AppFeedbackStatsOut(
        average_rating=_round(avg_all),
        picker_average=_round(picker_avg),
        controller_average=_round(controller_avg),
        total_count=int(total),
    )


@router.post("", response_model=AppFeedbackOut, summary="Submit app feedback")
@router.post("/", response_model=AppFeedbackOut, summary="Submit app feedback")
async def submit_app_feedback(
    payload: AppFeedbackCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    role = payload.role.strip().lower()
    module = payload.module.strip().lower()
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    if module not in VALID_MODULES:
        raise HTTPException(status_code=400, detail="Invalid module")

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    already_today = (
        db.query(UserAppFeedback)
        .filter(
            UserAppFeedback.user_id == user.id,
            UserAppFeedback.created_at >= today_start,
        )
        .count()
    )
    if already_today >= 1:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You can submit feedback once per day",
        )

    comment = (payload.comment or "").strip() or None
    row = UserAppFeedback(
        user_id=user.id,
        rating=payload.rating,
        comment=comment,
        role=role,
        module=module,
        context_ref=(payload.context_ref or "").strip() or None,
        app_version=(payload.app_version or "").strip() or None,
        platform=(payload.platform or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return AppFeedbackOut(
        id=row.id,
        user_id=row.user_id,
        username=user.username,
        full_name=user.full_name,
        rating=row.rating,
        comment=row.comment,
        role=row.role,
        module=row.module,
        context_ref=row.context_ref,
        app_version=row.app_version,
        platform=row.platform,
        created_at=row.created_at,
    )


@router.get("", response_model=AppFeedbackListOut, summary="List app feedback")
@router.get("/", response_model=AppFeedbackListOut, summary="List app feedback")
async def list_app_feedback(
    role: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    rating: Optional[int] = Query(None, ge=1, le=5),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("audit:read")),
):
    base = db.query(UserAppFeedback)
    filtered = _apply_list_filters(
        base,
        role=role,
        module=module,
        rating=rating,
        date_from=date_from,
        date_to=date_to,
    )
    stats = _compute_stats(filtered)
    total = stats.total_count
    rows = (
        filtered.order_by(UserAppFeedback.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    user_ids = {r.user_id for r in rows}
    users_map: dict[UUID, User] = {}
    if user_ids:
        users = db.query(User).filter(User.id.in_(user_ids)).all()
        users_map = {u.id: u for u in users}

    items = [
        AppFeedbackOut(
            id=r.id,
            user_id=r.user_id,
            username=users_map[r.user_id].username if r.user_id in users_map else None,
            full_name=users_map[r.user_id].full_name if r.user_id in users_map else None,
            rating=r.rating,
            comment=r.comment,
            role=r.role,
            module=r.module,
            context_ref=r.context_ref,
            app_version=r.app_version,
            platform=r.platform,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return AppFeedbackListOut(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        stats=stats,
    )
