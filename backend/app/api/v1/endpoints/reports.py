from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.models.location import Location as LocationModel
from app.models.product import Product as ProductModel
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.models.user import User as UserModel

router = APIRouter()


class StockSummaryRow(BaseModel):
    product_id: UUID
    sku: str
    product_name: str
    lot_id: UUID
    batch: str
    expiry_date: Optional[date] = None
    location_id: UUID
    location_code: str
    qty: Decimal


class FefoRiskRow(StockSummaryRow):
    days_to_expiry: Optional[int] = None


class PickerPerformanceRow(BaseModel):
    picker_id: UUID
    picker_name: str
    total_picked_qty: Decimal
    movements_count: int
    documents_count: int


def _stock_summary_query(db: Session):
    return (
        db.query(
            StockLotModel.product_id.label("product_id"),
            ProductModel.sku.label("sku"),
            ProductModel.name.label("product_name"),
            StockMovementModel.lot_id.label("lot_id"),
            StockLotModel.batch.label("batch"),
            StockLotModel.expiry_date.label("expiry_date"),
            StockMovementModel.location_id.label("location_id"),
            LocationModel.code.label("location_code"),
            func.sum(StockMovementModel.qty_change).label("qty"),
        )
        .join(StockLotModel, StockLotModel.id == StockMovementModel.lot_id)
        .join(ProductModel, ProductModel.id == StockLotModel.product_id)
        .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
        .filter(StockMovementModel.movement_type != "pick")
        .group_by(
            StockLotModel.product_id,
            ProductModel.sku,
            ProductModel.name,
            StockMovementModel.lot_id,
            StockLotModel.batch,
            StockLotModel.expiry_date,
            StockMovementModel.location_id,
            LocationModel.code,
        )
    )


@router.get("/stock-summary", response_model=List[StockSummaryRow], summary="Stock summary by lot/location")
async def stock_summary(
    product_id: Optional[UUID] = None,
    location_id: Optional[UUID] = None,
    include_zero: bool = Query(False),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("reports:read")),
):
    query = _stock_summary_query(db)
    if product_id:
        query = query.filter(StockLotModel.product_id == product_id)
    if location_id:
        query = query.filter(StockMovementModel.location_id == location_id)
    if not include_zero:
        query = query.having(func.sum(StockMovementModel.qty_change) != 0)

    rows = query.order_by(ProductModel.sku.asc(), StockLotModel.expiry_date.asc().nullslast()).all()
    return [StockSummaryRow(**row._asdict()) for row in rows]


@router.get("/fefo-risk", response_model=List[FefoRiskRow], summary="FEFO risk (expiring soon)")
async def fefo_risk(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("reports:read")),
):
    query = _stock_summary_query(db)
    cutoff = func.current_date() + days
    query = query.filter(StockLotModel.expiry_date.is_not(None)).filter(StockLotModel.expiry_date <= cutoff)
    query = query.having(func.sum(StockMovementModel.qty_change) > 0)

    rows = query.order_by(StockLotModel.expiry_date.asc(), ProductModel.sku.asc()).all()
    results: List[FefoRiskRow] = []
    for row in rows:
        days_to_expiry = None
        if row.expiry_date:
            days_to_expiry = (row.expiry_date - date.today()).days
        payload = row._asdict()
        payload["days_to_expiry"] = days_to_expiry
        results.append(FefoRiskRow(**payload))
    return results


@router.get("/picker-performance", response_model=List[PickerPerformanceRow], summary="Picker performance")
async def picker_performance(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("reports:read")),
):
    query = (
        db.query(
            StockMovementModel.created_by.label("picker_id"),
            UserModel.full_name.label("picker_name"),
            func.sum(-StockMovementModel.qty_change).label("total_picked_qty"),
            func.count(StockMovementModel.id).label("movements_count"),
            func.count(func.distinct(StockMovementModel.source_document_id)).label("documents_count"),
        )
        .join(UserModel, UserModel.id == StockMovementModel.created_by)
        .filter(StockMovementModel.movement_type == "pick")
        .group_by(StockMovementModel.created_by, UserModel.full_name)
    )
    if date_from:
        query = query.filter(func.date(StockMovementModel.created_at) >= date_from)
    if date_to:
        query = query.filter(func.date(StockMovementModel.created_at) <= date_to)

    rows = query.order_by(func.sum(-StockMovementModel.qty_change).desc()).all()
    results = []
    for row in rows:
        picker_name = row.picker_name or "Unknown"
        results.append(
            PickerPerformanceRow(
                picker_id=row.picker_id,
                picker_name=picker_name,
                total_picked_qty=row.total_picked_qty or Decimal("0"),
                movements_count=row.movements_count or 0,
                documents_count=row.documents_count or 0,
            )
        )
    return results
