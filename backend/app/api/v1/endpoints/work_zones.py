"""Work zones excluded from main SmartUp order import (room_id match)."""
from __future__ import annotations

from datetime import datetime
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.deps import require_any_permission, require_permission
from app.db import get_db
from app.models.work_zone import WorkZone as WorkZoneModel
from app.services.audit_service import (
    ACTION_CREATE,
    ACTION_DELETE,
    ACTION_UPDATE,
    get_client_ip,
    log_action,
)

router = APIRouter()


class WorkZoneOut(BaseModel):
    id: UUID
    room_id: str
    name: str | None
    created_at: datetime


class WorkZoneCreate(BaseModel):
    room_id: str = Field(..., min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=255)


class WorkZoneUpdate(BaseModel):
    room_id: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=255)


def _to_out(item: WorkZoneModel) -> WorkZoneOut:
    return WorkZoneOut(
        id=item.id,
        room_id=item.room_id,
        name=item.name,
        created_at=item.created_at,
    )


@router.get("", response_model=List[WorkZoneOut], summary="List work zones")
@router.get("/", response_model=List[WorkZoneOut], summary="List work zones")
async def list_work_zones(
    search: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["orders:read", "receiving:write", "admin:access"])),
):
    query = db.query(WorkZoneModel)
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                WorkZoneModel.room_id.ilike(term),
                WorkZoneModel.name.ilike(term),
            )
        )
    items = query.order_by(WorkZoneModel.room_id.asc()).offset(offset).limit(limit).all()
    return [_to_out(i) for i in items]


@router.post("", response_model=WorkZoneOut, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=WorkZoneOut, status_code=status.HTTP_201_CREATED)
async def create_work_zone(
    request: Request,
    payload: WorkZoneCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:read")),
):
    rid = payload.room_id.strip()
    existing = db.query(WorkZoneModel).filter(WorkZoneModel.room_id == rid).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Work zone with this room_id already exists")
    item = WorkZoneModel(
        room_id=rid,
        name=payload.name.strip() if payload.name else None,
    )
    db.add(item)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_CREATE,
        entity_type="work_zone",
        entity_id=str(item.id),
        new_data={"room_id": item.room_id, "name": item.name},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(item)
    return _to_out(item)


@router.put("/{item_id}", response_model=WorkZoneOut)
async def update_work_zone(
    request: Request,
    item_id: UUID,
    payload: WorkZoneUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:read")),
):
    item = db.query(WorkZoneModel).filter(WorkZoneModel.id == item_id).one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Work zone not found")
    old_data = {"room_id": item.room_id, "name": item.name}
    if payload.room_id is not None:
        rid = payload.room_id.strip()
        if rid != item.room_id:
            conflict = (
                db.query(WorkZoneModel)
                .filter(WorkZoneModel.room_id == rid, WorkZoneModel.id != item_id)
                .one_or_none()
            )
            if conflict:
                raise HTTPException(status_code=409, detail="Work zone with this room_id already exists")
            item.room_id = rid
    if payload.name is not None:
        item.name = payload.name.strip() if payload.name else None
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="work_zone",
        entity_id=str(item_id),
        old_data=old_data,
        new_data={"room_id": item.room_id, "name": item.name},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(item)
    return _to_out(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_work_zone(
    request: Request,
    item_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:read")),
):
    item = db.query(WorkZoneModel).filter(WorkZoneModel.id == item_id).one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Work zone not found")
    log_action(
        db,
        user_id=user.id,
        action=ACTION_DELETE,
        entity_type="work_zone",
        entity_id=str(item_id),
        old_data={"room_id": item.room_id, "name": item.name},
        ip_address=get_client_ip(request),
    )
    db.delete(item)
    db.commit()
