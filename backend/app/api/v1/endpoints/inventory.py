from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_permission
from app.db import get_db
from app.models.location import Location as LocationModel
from app.models.product import Product as ProductModel
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.models.user import User as UserModel

router = APIRouter()

MOVEMENT_TYPES = {"receipt", "putaway", "allocate", "pick", "ship", "adjust"}


class StockLotOut(BaseModel):
    id: UUID
    product_id: UUID
    batch: str
    expiry_date: Optional[date] = None
    created_at: datetime


class StockLotCreate(BaseModel):
    product_id: UUID
    batch: str = Field(..., min_length=1, max_length=64)
    expiry_date: Optional[date] = None


class StockMovementOut(BaseModel):
    id: UUID
    product_id: UUID
    lot_id: UUID
    location_id: UUID
    qty_change: Decimal
    movement_type: str
    source_document_type: Optional[str] = None
    source_document_id: Optional[UUID] = None
    created_at: datetime
    created_by: Optional[UUID] = None


class StockMovementCreate(BaseModel):
    product_id: UUID
    lot_id: UUID
    location_id: UUID
    qty_change: Decimal
    movement_type: str = Field(..., min_length=1, max_length=32)
    source_document_type: Optional[str] = Field(default=None, max_length=32)
    source_document_id: Optional[UUID] = None


class StockBalanceOut(BaseModel):
    product_id: UUID
    lot_id: UUID
    location_id: UUID
    qty: Decimal
    batch: str
    expiry_date: Optional[date] = None


def _to_lot(lot: StockLotModel) -> StockLotOut:
    return StockLotOut(
        id=lot.id,
        product_id=lot.product_id,
        batch=lot.batch,
        expiry_date=lot.expiry_date,
        created_at=lot.created_at,
    )


def _to_movement(movement: StockMovementModel) -> StockMovementOut:
    return StockMovementOut(
        id=movement.id,
        product_id=movement.product_id,
        lot_id=movement.lot_id,
        location_id=movement.location_id,
        qty_change=movement.qty_change,
        movement_type=movement.movement_type,
        source_document_type=movement.source_document_type,
        source_document_id=movement.source_document_id,
        created_at=movement.created_at,
        created_by=movement.created_by,
    )


@router.get("/lots", response_model=List[StockLotOut], summary="List stock lots")
@router.get("/lots/", response_model=List[StockLotOut], summary="List stock lots")
async def list_stock_lots(
    product_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    query = db.query(StockLotModel)
    if product_id:
        query = query.filter(StockLotModel.product_id == product_id)
    lots = query.order_by(StockLotModel.expiry_date.asc().nullslast(), StockLotModel.batch.asc()).all()
    return [_to_lot(lot) for lot in lots]


@router.post("/lots", response_model=StockLotOut, status_code=status.HTTP_201_CREATED)
@router.post("/lots/", response_model=StockLotOut, status_code=status.HTTP_201_CREATED)
async def create_stock_lot(
    payload: StockLotCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:adjust")),
):
    product = db.query(ProductModel.id).filter(ProductModel.id == payload.product_id).one_or_none()
    if not product:
        raise HTTPException(status_code=400, detail="Product not found")

    existing = (
        db.query(StockLotModel)
        .filter(
            StockLotModel.product_id == payload.product_id,
            StockLotModel.batch == payload.batch,
            StockLotModel.expiry_date == payload.expiry_date,
        )
        .one_or_none()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Stock lot already exists")

    lot = StockLotModel(
        product_id=payload.product_id,
        batch=payload.batch.strip(),
        expiry_date=payload.expiry_date,
    )
    db.add(lot)
    db.commit()
    db.refresh(lot)
    return _to_lot(lot)


@router.get("/movements", response_model=List[StockMovementOut], summary="List stock movements")
@router.get("/movements/", response_model=List[StockMovementOut], summary="List stock movements")
async def list_stock_movements(
    product_id: Optional[UUID] = None,
    lot_id: Optional[UUID] = None,
    location_id: Optional[UUID] = None,
    movement_type: Optional[str] = None,
    source_document_type: Optional[str] = None,
    source_document_id: Optional[UUID] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    query = db.query(StockMovementModel)
    if product_id:
        query = query.filter(StockMovementModel.product_id == product_id)
    if lot_id:
        query = query.filter(StockMovementModel.lot_id == lot_id)
    if location_id:
        query = query.filter(StockMovementModel.location_id == location_id)
    if movement_type:
        query = query.filter(StockMovementModel.movement_type == movement_type)
    if source_document_type:
        query = query.filter(StockMovementModel.source_document_type == source_document_type)
    if source_document_id:
        query = query.filter(StockMovementModel.source_document_id == source_document_id)

    movements = (
        query.order_by(StockMovementModel.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_to_movement(movement) for movement in movements]


@router.post("/movements", response_model=StockMovementOut, status_code=status.HTTP_201_CREATED)
@router.post("/movements/", response_model=StockMovementOut, status_code=status.HTTP_201_CREATED)
async def create_stock_movement(
    payload: StockMovementCreate,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_permission("inventory:adjust")),
):
    # Stock ledger is append-only; no update/delete endpoints by design.
    if payload.movement_type not in MOVEMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid movement type")
    if payload.qty_change == 0:
        raise HTTPException(status_code=400, detail="Quantity change cannot be zero")
    if (payload.source_document_type and not payload.source_document_id) or (
        payload.source_document_id and not payload.source_document_type
    ):
        raise HTTPException(status_code=400, detail="Source document type and id must be provided together")

    product = db.query(ProductModel.id).filter(ProductModel.id == payload.product_id).one_or_none()
    if not product:
        raise HTTPException(status_code=400, detail="Product not found")
    lot = db.query(StockLotModel).filter(StockLotModel.id == payload.lot_id).one_or_none()
    if not lot:
        raise HTTPException(status_code=400, detail="Stock lot not found")
    if lot.product_id != payload.product_id:
        raise HTTPException(status_code=400, detail="Stock lot does not belong to product")
    location = (
        db.query(LocationModel.id).filter(LocationModel.id == payload.location_id).one_or_none()
    )
    if not location:
        raise HTTPException(status_code=400, detail="Location not found")

    movement = StockMovementModel(
        product_id=payload.product_id,
        lot_id=payload.lot_id,
        location_id=payload.location_id,
        qty_change=payload.qty_change,
        movement_type=payload.movement_type,
        source_document_type=payload.source_document_type,
        source_document_id=payload.source_document_id,
        created_by=user.id,
    )
    db.add(movement)
    db.commit()
    db.refresh(movement)
    return _to_movement(movement)


@router.get("/balances", response_model=List[StockBalanceOut], summary="List stock balances")
@router.get("/balances/", response_model=List[StockBalanceOut], summary="List stock balances")
async def list_stock_balances(
    product_id: Optional[UUID] = None,
    lot_id: Optional[UUID] = None,
    location_id: Optional[UUID] = None,
    include_zero: bool = Query(False),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    query = (
        db.query(
            StockMovementModel.lot_id,
            StockMovementModel.location_id,
            func.sum(StockMovementModel.qty_change).label("qty"),
            StockLotModel.product_id,
            StockLotModel.batch,
            StockLotModel.expiry_date,
        )
        .join(StockLotModel, StockLotModel.id == StockMovementModel.lot_id)
        .group_by(
            StockMovementModel.lot_id,
            StockMovementModel.location_id,
            StockLotModel.product_id,
            StockLotModel.batch,
            StockLotModel.expiry_date,
        )
    )
    if product_id:
        query = query.filter(StockLotModel.product_id == product_id)
    if lot_id:
        query = query.filter(StockMovementModel.lot_id == lot_id)
    if location_id:
        query = query.filter(StockMovementModel.location_id == location_id)
    if not include_zero:
        query = query.having(func.sum(StockMovementModel.qty_change) != 0)

    rows = query.all()
    return [
        StockBalanceOut(
            product_id=row.product_id,
            lot_id=row.lot_id,
            location_id=row.location_id,
            qty=row.qty,
            batch=row.batch,
            expiry_date=row.expiry_date,
        )
        for row in rows
    ]
