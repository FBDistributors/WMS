"""Admin-managed organization reference list (org_id + name)."""
from __future__ import annotations

from datetime import datetime
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.auth.deps import require_any_permission, require_permission
from app.db import get_db
from app.models.settings_organization import SettingsOrganization as SettingsOrganizationModel
from app.services.audit_service import (
    ACTION_CREATE,
    ACTION_DELETE,
    ACTION_UPDATE,
    get_client_ip,
    log_action,
)

router = APIRouter()

_MIGRATION_HINT = (
    "DB migration required: run `alembic upgrade head` (revision 20260521_0075 settings_organizations)."
)


def _is_missing_table(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "settings_organizations" in msg and (
        "does not exist" in msg
        or "no such table" in msg
        or "undefinedtable" in msg
        or "relation" in msg and "exist" in msg
    )


def _raise_if_schema_error(exc: BaseException) -> None:
    if isinstance(exc, (ProgrammingError, OperationalError)) and _is_missing_table(exc):
        raise HTTPException(status_code=503, detail=_MIGRATION_HINT) from exc


class SettingsOrganizationOut(BaseModel):
    id: UUID
    org_id: str
    name: str | None
    created_at: datetime


class SettingsOrganizationCreate(BaseModel):
    org_id: str = Field(..., min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=255)


class SettingsOrganizationUpdate(BaseModel):
    org_id: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=255)


def _to_out(item: SettingsOrganizationModel) -> SettingsOrganizationOut:
    return SettingsOrganizationOut(
        id=item.id,
        org_id=item.org_id,
        name=item.name,
        created_at=item.created_at,
    )


@router.get("", response_model=List[SettingsOrganizationOut], summary="List organizations")
@router.get("/", response_model=List[SettingsOrganizationOut], summary="List organizations")
async def list_settings_organizations(
    search: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["orders:read", "receiving:write", "admin:access"])),
):
    try:
        query = db.query(SettingsOrganizationModel)
        if search:
            term = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    SettingsOrganizationModel.org_id.ilike(term),
                    SettingsOrganizationModel.name.ilike(term),
                )
            )
        items = (
            query.order_by(SettingsOrganizationModel.org_id.asc()).offset(offset).limit(limit).all()
        )
        return [_to_out(i) for i in items]
    except (ProgrammingError, OperationalError) as exc:
        db.rollback()
        _raise_if_schema_error(exc)
        raise


@router.post("", response_model=SettingsOrganizationOut, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=SettingsOrganizationOut, status_code=status.HTTP_201_CREATED)
async def create_settings_organization(
    request: Request,
    payload: SettingsOrganizationCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:read")),
):
    oid = payload.org_id.strip()
    try:
        existing = (
            db.query(SettingsOrganizationModel)
            .filter(SettingsOrganizationModel.org_id == oid)
            .one_or_none()
        )
        if existing:
            raise HTTPException(status_code=409, detail="Organization with this id already exists")
        item = SettingsOrganizationModel(
            org_id=oid,
            name=payload.name.strip() if payload.name else None,
        )
        db.add(item)
        db.flush()
        log_action(
            db,
            user_id=user.id,
            action=ACTION_CREATE,
            entity_type="settings_organization",
            entity_id=str(item.id),
            new_data={"org_id": item.org_id, "name": item.name},
            ip_address=get_client_ip(request),
        )
        db.commit()
        db.refresh(item)
        return _to_out(item)
    except HTTPException:
        raise
    except (ProgrammingError, OperationalError) as exc:
        db.rollback()
        _raise_if_schema_error(exc)
        raise


@router.put("/{item_id}", response_model=SettingsOrganizationOut)
async def update_settings_organization(
    request: Request,
    item_id: UUID,
    payload: SettingsOrganizationUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:read")),
):
    try:
        item = (
            db.query(SettingsOrganizationModel)
            .filter(SettingsOrganizationModel.id == item_id)
            .one_or_none()
        )
        if not item:
            raise HTTPException(status_code=404, detail="Organization not found")
        old_data = {"org_id": item.org_id, "name": item.name}
        if payload.org_id is not None:
            oid = payload.org_id.strip()
            if oid != item.org_id:
                conflict = (
                    db.query(SettingsOrganizationModel)
                    .filter(
                        SettingsOrganizationModel.org_id == oid,
                        SettingsOrganizationModel.id != item_id,
                    )
                    .one_or_none()
                )
                if conflict:
                    raise HTTPException(
                        status_code=409, detail="Organization with this id already exists"
                    )
                item.org_id = oid
        if payload.name is not None:
            item.name = payload.name.strip() if payload.name else None
        log_action(
            db,
            user_id=user.id,
            action=ACTION_UPDATE,
            entity_type="settings_organization",
            entity_id=str(item_id),
            old_data=old_data,
            new_data={"org_id": item.org_id, "name": item.name},
            ip_address=get_client_ip(request),
        )
        db.commit()
        db.refresh(item)
        return _to_out(item)
    except HTTPException:
        raise
    except (ProgrammingError, OperationalError) as exc:
        db.rollback()
        _raise_if_schema_error(exc)
        raise


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_settings_organization(
    request: Request,
    item_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:read")),
):
    try:
        item = (
            db.query(SettingsOrganizationModel)
            .filter(SettingsOrganizationModel.id == item_id)
            .one_or_none()
        )
        if not item:
            raise HTTPException(status_code=404, detail="Organization not found")
        log_action(
            db,
            user_id=user.id,
            action=ACTION_DELETE,
            entity_type="settings_organization",
            entity_id=str(item_id),
            old_data={"org_id": item.org_id, "name": item.name},
            ip_address=get_client_ip(request),
        )
        db.delete(item)
        db.commit()
    except HTTPException:
        raise
    except (ProgrammingError, OperationalError) as exc:
        db.rollback()
        _raise_if_schema_error(exc)
        raise
