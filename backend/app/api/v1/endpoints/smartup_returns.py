"""Admin: SmartUp mijoz qaytarishlari (sinxronlangan) ro'yxati va sinxron tugmasi."""
from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import require_any_permission, require_permission
from app.db import get_db
from app.integrations.smartup.returns_export import sync_returns
from app.models.smartup_return import SmartupReturn, SmartupReturnLine

router = APIRouter()
logger = logging.getLogger(__name__)


class SmartupReturnLineOut(BaseModel):
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    return_quant: Optional[Decimal] = None
    product_price: Optional[Decimal] = None
    expiry_date: Optional[str] = None
    warehouse_code: Optional[str] = None
    action_name: Optional[str] = None


class SmartupReturnOut(BaseModel):
    id: UUID
    deal_id: str
    order_deal_id: Optional[str] = None
    return_date: Optional[date] = None
    person_name: Optional[str] = None
    person_code: Optional[str] = None
    return_reason_id: Optional[str] = None
    sales_manager_name: Optional[str] = None
    total_amount: Optional[Decimal] = None
    status: Optional[str] = None
    wms_status: str
    note: Optional[str] = None
    lines_count: int
    lines: List[SmartupReturnLineOut]


class SmartupReturnsListResponse(BaseModel):
    items: List[SmartupReturnOut]
    total: int


class SmartupReturnsSyncResponse(BaseModel):
    fetched: int
    created: int
    updated: int


def _to_out(r: SmartupReturn) -> SmartupReturnOut:
    return SmartupReturnOut(
        id=r.id,
        deal_id=r.deal_id,
        order_deal_id=r.order_deal_id,
        return_date=r.return_date,
        person_name=r.person_name,
        person_code=r.person_code,
        return_reason_id=r.return_reason_id,
        sales_manager_name=r.sales_manager_name,
        total_amount=r.total_amount,
        status=r.status,
        wms_status=r.wms_status,
        note=r.note,
        lines_count=len(r.lines),
        lines=[
            SmartupReturnLineOut(
                product_code=l.product_code,
                product_name=l.product_name,
                return_quant=l.return_quant,
                product_price=l.product_price,
                expiry_date=l.expiry_date,
                warehouse_code=l.warehouse_code,
                action_name=l.action_name,
            )
            for l in sorted(r.lines, key=lambda x: x.line_no or 0)
        ],
    )


@router.get("", response_model=SmartupReturnsListResponse, summary="SmartUp qaytarishlar ro'yxati")
@router.get("/", response_model=SmartupReturnsListResponse)
def list_smartup_returns(
    q: Optional[str] = Query(None, description="Mijoz nomi / deal_id / buyurtma bo'yicha qidiruv"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
) -> SmartupReturnsListResponse:
    query = db.query(SmartupReturn).options(selectinload(SmartupReturn.lines))
    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                SmartupReturn.person_name.ilike(term),
                SmartupReturn.deal_id.ilike(term),
                SmartupReturn.order_deal_id.ilike(term),
            )
        )
    total = query.count()
    rows = (
        query.order_by(SmartupReturn.return_date.desc().nullslast(), SmartupReturn.deal_time.desc().nullslast())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return SmartupReturnsListResponse(items=[_to_out(r) for r in rows], total=total)


@router.post("/sync", response_model=SmartupReturnsSyncResponse, summary="SmartUp'dan oxirgi 30 kunni sinxronlash")
def sync_smartup_returns(
    days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("admin:access")),
) -> SmartupReturnsSyncResponse:
    try:
        result = sync_returns(db, days=days)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("SmartUp returns sync error")
        raise HTTPException(status_code=500, detail="Sinxronlashda xato") from e
    return SmartupReturnsSyncResponse(**result)
