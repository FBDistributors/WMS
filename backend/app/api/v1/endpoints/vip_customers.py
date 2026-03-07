"""VIP customers CRUD: mijoz id, nomi, muddat chegarasi (oy)."""
from __future__ import annotations

from datetime import datetime
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.models.vip_customer import VipCustomer as VipCustomerModel
from app.services.audit_service import (
    ACTION_CREATE,
    ACTION_DELETE,
    ACTION_UPDATE,
    get_client_ip,
    log_action,
)

router = APIRouter()


class VipCustomerOut(BaseModel):
    id: UUID
    customer_id: str
    customer_name: str | None
    min_expiry_months: int
    created_at: datetime


class VipCustomerCreate(BaseModel):
    customer_id: str = Field(..., min_length=1, max_length=64)
    customer_name: str | None = Field(default=None, max_length=255)
    min_expiry_months: int = Field(..., ge=1, le=60, description="Muddat chegarasi (oy)")


class VipCustomerUpdate(BaseModel):
    customer_name: str | None = Field(default=None, max_length=255)
    min_expiry_months: int | None = Field(default=None, ge=1, le=60)


def _to_out(v: VipCustomerModel) -> VipCustomerOut:
    return VipCustomerOut(
        id=v.id,
        customer_id=v.customer_id,
        customer_name=v.customer_name,
        min_expiry_months=v.min_expiry_months,
        created_at=v.created_at,
    )


@router.get("", response_model=List[VipCustomerOut], summary="List VIP customers")
@router.get("/", response_model=List[VipCustomerOut], summary="List VIP customers")
async def list_vip_customers(
    search: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:read")),
):
    query = db.query(VipCustomerModel)
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                VipCustomerModel.customer_id.ilike(term),
                VipCustomerModel.customer_name.ilike(term),
            )
        )
    items = query.order_by(VipCustomerModel.customer_id.asc()).offset(offset).limit(limit).all()
    return [_to_out(v) for v in items]


@router.post("", response_model=VipCustomerOut, status_code=status.HTTP_201_CREATED, summary="Create VIP customer")
@router.post("/", response_model=VipCustomerOut, status_code=status.HTTP_201_CREATED, summary="Create VIP customer")
async def create_vip_customer(
    request: Request,
    payload: VipCustomerCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:read")),
):
    existing = db.query(VipCustomerModel).filter(VipCustomerModel.customer_id == payload.customer_id.strip()).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="VIP customer with this customer_id already exists")
    vip = VipCustomerModel(
        customer_id=payload.customer_id.strip(),
        customer_name=payload.customer_name.strip() if payload.customer_name else None,
        min_expiry_months=payload.min_expiry_months,
    )
    db.add(vip)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_CREATE,
        entity_type="vip_customer",
        entity_id=str(vip.id),
        new_data={"customer_id": vip.customer_id, "min_expiry_months": vip.min_expiry_months},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(vip)
    return _to_out(vip)


@router.put("/{vip_id}", response_model=VipCustomerOut, summary="Update VIP customer")
async def update_vip_customer(
    request: Request,
    vip_id: UUID,
    payload: VipCustomerUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:read")),
):
    vip = db.query(VipCustomerModel).filter(VipCustomerModel.id == vip_id).one_or_none()
    if not vip:
        raise HTTPException(status_code=404, detail="VIP customer not found")
    old_data = {"customer_name": vip.customer_name, "min_expiry_months": vip.min_expiry_months}
    if payload.customer_name is not None:
        vip.customer_name = payload.customer_name.strip() or None
    if payload.min_expiry_months is not None:
        vip.min_expiry_months = payload.min_expiry_months
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="vip_customer",
        entity_id=str(vip_id),
        old_data=old_data,
        new_data={"customer_name": vip.customer_name, "min_expiry_months": vip.min_expiry_months},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(vip)
    return _to_out(vip)


@router.delete("/{vip_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete VIP customer")
async def delete_vip_customer(
    request: Request,
    vip_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:read")),
):
    vip = db.query(VipCustomerModel).filter(VipCustomerModel.id == vip_id).one_or_none()
    if not vip:
        raise HTTPException(status_code=404, detail="VIP customer not found")
    log_action(
        db,
        user_id=user.id,
        action=ACTION_DELETE,
        entity_type="vip_customer",
        entity_id=str(vip_id),
        old_data={"customer_id": vip.customer_id},
        ip_address=get_client_ip(request),
    )
    db.delete(vip)
    db.commit()
