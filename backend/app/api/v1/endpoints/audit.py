"""
Audit logs API. Read-only, admin only.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.models.audit_log import AuditLog
from app.models.user import User

router = APIRouter()


class AuditLogOut(BaseModel):
    id: UUID
    user_id: Optional[UUID] = None
    username: Optional[str] = None
    action: str
    entity_type: str
    entity_id: str
    old_data: Optional[dict] = None
    new_data: Optional[dict] = None
    ip_address: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class AuditLogListOut(BaseModel):
    items: List[AuditLogOut]
    total: int
    limit: int
    offset: int


@router.get("", response_model=AuditLogListOut, summary="List audit logs")
@router.get("/", response_model=AuditLogListOut, summary="List audit logs")
async def list_audit_logs(
    entity_type: Optional[str] = Query(None, description="Filter by entity type"),
    user_id: Optional[UUID] = Query(None, description="Filter by user ID"),
    date_from: Optional[str] = Query(None, description="From date YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="To date YYYY-MM-DD"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("audit:read")),
):
    """List audit logs with filters. Admin only."""
    query = db.query(AuditLog)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if date_from:
        try:
            d = datetime.strptime(date_from, "%Y-%m-%d").date()
            query = query.filter(func.date(AuditLog.created_at) >= d)
        except ValueError:
            pass
    if date_to:
        try:
            d = datetime.strptime(date_to, "%Y-%m-%d").date()
            query = query.filter(func.date(AuditLog.created_at) <= d)
        except ValueError:
            pass

    total = query.with_entities(func.count(AuditLog.id)).scalar() or 0
    rows = (
        query.order_by(AuditLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    user_ids = {r.user_id for r in rows if r.user_id}
    users_map = {}
    if user_ids:
        users = db.query(User.id, User.username).filter(User.id.in_(user_ids)).all()
        users_map = {u.id: u.username for u in users}

    items = [
        AuditLogOut(
            id=r.id,
            user_id=r.user_id,
            username=users_map.get(r.user_id),
            action=r.action,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            old_data=r.old_data,
            new_data=r.new_data,
            ip_address=r.ip_address,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return AuditLogListOut(items=items, total=total, limit=limit, offset=offset)
