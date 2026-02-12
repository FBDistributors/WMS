"""
Picker-only read-only inventory endpoints.
Optimized for mobile with FEFO ordering and barcode/location search.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_any_permission
from app.db import get_db
from app.models.location import Location as LocationModel
from app.models.product import Product as ProductModel
from app.models.product import ProductBarcode
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.models.user import User as UserModel

router = APIRouter()

# Picker/operator/manager read-only access (not admin inventory management)
PICKER_INVENTORY_PERMISSION = require_any_permission(["picking:read", "inventory:read"])


class PickerLotInfo(BaseModel):
    location_code: str
    batch_no: str
    expiry_date: date | None
    available_qty: Decimal
    reserved_qty: Decimal


class PickerInventoryItem(BaseModel):
    product_id: UUID
    name: str
    main_barcode: str | None
    best_location: str | None
    available_qty: Decimal
    nearest_expiry: date | None
    top_locations: list[PickerLotInfo]


class PickerInventoryListResponse(BaseModel):
    items: list[PickerInventoryItem]
    next_cursor: str | None


class PickerProductLocation(BaseModel):
    location_id: UUID
    location_code: str
    lot_id: UUID
    batch_no: str
    expiry_date: date | None
    on_hand_qty: Decimal
    reserved_qty: Decimal
    available_qty: Decimal


class PickerProductDetailResponse(BaseModel):
    product_id: UUID
    name: str
    main_barcode: str | None
    locations: list[PickerProductLocation]


class PickerLocationOption(BaseModel):
    id: UUID
    code: str
    name: str



def _get_product_main_barcode(db: Session, product: ProductModel) -> str | None:
    if product.barcode:
        return product.barcode
    b = db.query(ProductBarcode.barcode).filter(ProductBarcode.product_id == product.id).first()
    return b[0] if b else None


def _get_lot_level_balances(
    db: Session,
    product_ids: list[UUID],
    location_id: Optional[UUID] = None,
) -> list[dict[str, Any]]:
    on_hand_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(("allocate", "unallocate")),
                0,
            ),
            else_=StockMovementModel.qty_change,
        )
    )
    reserved_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(("allocate", "unallocate")),
                StockMovementModel.qty_change,
            ),
            else_=0,
        )
    )
    query = (
        db.query(
            StockLotModel.product_id,
            StockLotModel.id.label("lot_id"),
            StockLotModel.batch,
            StockLotModel.expiry_date,
            StockMovementModel.location_id,
            LocationModel.code.label("location_code"),
            on_hand_expr.label("on_hand"),
            reserved_expr.label("reserved"),
            (on_hand_expr - reserved_expr).label("available"),
        )
        .join(StockLotModel, StockLotModel.id == StockMovementModel.lot_id)
        .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
        .filter(StockLotModel.product_id.in_(product_ids))
        .group_by(
            StockLotModel.product_id,
            StockLotModel.id,
            StockLotModel.batch,
            StockLotModel.expiry_date,
            StockMovementModel.location_id,
            LocationModel.code,
        )
        .having(on_hand_expr - reserved_expr != 0)
    )
    if location_id:
        query = query.filter(StockMovementModel.location_id == location_id)
    rows = (
        query.order_by(StockLotModel.expiry_date.asc().nullslast(), StockLotModel.batch.asc())
        .all()
    )
    return [row._asdict() for row in rows]


def _build_picker_items(
    db: Session,
    products: list[ProductModel],
    lot_data: list[dict],
    top_n: int = 3,
) -> list[PickerInventoryItem]:
    by_product: dict[UUID, list[dict]] = {}
    for row in lot_data:
        pid = row["product_id"]
        if pid not in by_product:
            by_product[pid] = []
        by_product[pid].append(row)
    items = []
    for p in products:
        lots = by_product.get(p.id, [])
        total_available = sum(Decimal(str(r["available"])) for r in lots)
        main_barcode = _get_product_main_barcode(db, p)
        best_location = None
        nearest_expiry = None
        top_locs = []
        for i, r in enumerate(lots[:top_n]):
            loc = PickerLotInfo(
                location_code=r["location_code"],
                batch_no=r["batch"],
                expiry_date=r["expiry_date"],
                available_qty=Decimal(str(r["available"])),
                reserved_qty=Decimal(str(r["reserved"])),
            )
            top_locs.append(loc)
            if i == 0:
                best_location = r["location_code"]
                nearest_expiry = r["expiry_date"]
        items.append(
            PickerInventoryItem(
                product_id=p.id,
                name=p.name,
                main_barcode=main_barcode,
                best_location=best_location,
                available_qty=total_available,
                nearest_expiry=nearest_expiry,
                top_locations=top_locs,
            )
        )
    return items


@router.get(
    "/picker/locations",
    response_model=list[PickerLocationOption],
    summary="List locations for picker filter",
)
async def list_picker_locations(
    db: Session = Depends(get_db),
    _user: UserModel = Depends(get_current_user),
    _guard=Depends(PICKER_INVENTORY_PERMISSION),
):
    rows = (
        db.query(LocationModel.id, LocationModel.code, LocationModel.name)
        .filter(LocationModel.is_active == True)
        .order_by(LocationModel.code)
        .all()
    )
    return [PickerLocationOption(id=r.id, code=r.code, name=r.name) for r in rows]


@router.get(
    "/picker",
    response_model=PickerInventoryListResponse,
    summary="Picker inventory list (read-only)",
)
@router.get(
    "/picker/",
    response_model=PickerInventoryListResponse,
    summary="Picker inventory list (read-only)",
)
async def list_picker_inventory(
    q: Optional[str] = Query(None, description="Search by product name or SKU"),
    barcode: Optional[str] = Query(None, description="Exact barcode match"),
    location_id: Optional[UUID] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    cursor: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _user: UserModel = Depends(get_current_user),
    _guard=Depends(PICKER_INVENTORY_PERMISSION),
):
    query = db.query(ProductModel).filter(ProductModel.is_active == True)
    if q:
        term = f"%{q.strip()}%"
        from sqlalchemy import or_

        barcode_subq = (
            db.query(ProductBarcode.product_id)
            .filter(ProductBarcode.barcode.ilike(term))
        )
        query = query.filter(
            or_(
                func.lower(ProductModel.name).ilike(func.lower(term)),
                func.lower(ProductModel.sku).ilike(func.lower(term)),
                ProductModel.barcode.ilike(term),
                ProductModel.id.in_(barcode_subq),
            )
        )
    if barcode:
        exact = barcode.strip()
        query = query.filter(
            (ProductModel.barcode == exact)
            | ProductModel.id.in_(
                db.query(ProductBarcode.product_id).filter(ProductBarcode.barcode == exact)
            )
        )
    query = query.order_by(ProductModel.sku.asc())
    if cursor:
        try:
            cursor_uuid = UUID(cursor)
            query = query.filter(ProductModel.id > cursor_uuid)
        except ValueError:
            pass
    products = query.limit(limit + 1).all()
    has_more = len(products) > limit
    products = products[:limit]
    next_cursor = str(products[-1].id) if has_more and products else None
    if not products:
        return PickerInventoryListResponse(items=[], next_cursor=None)
    product_ids = [p.id for p in products]
    lot_data = _get_lot_level_balances(db, product_ids, location_id)
    items = _build_picker_items(db, products, lot_data, top_n=3)
    return PickerInventoryListResponse(items=items, next_cursor=next_cursor)


@router.get(
    "/picker/{product_id}",
    response_model=PickerProductDetailResponse,
    summary="Picker product detail (full breakdown)",
)
async def get_picker_product_detail(
    product_id: UUID,
    db: Session = Depends(get_db),
    _user: UserModel = Depends(get_current_user),
    _guard=Depends(PICKER_INVENTORY_PERMISSION),
):
    product = db.query(ProductModel).filter(ProductModel.id == product_id).one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    lot_data = _get_lot_level_balances(db, [product_id])
    main_barcode = _get_product_main_barcode(db, product)
    locations = [
        PickerProductLocation(
            location_id=r["location_id"],
            location_code=r["location_code"],
            lot_id=r["lot_id"],
            batch_no=r["batch"],
            expiry_date=r["expiry_date"],
            on_hand_qty=Decimal(str(r["on_hand"])),
            reserved_qty=Decimal(str(r["reserved"])),
            available_qty=Decimal(str(r["available"])),
        )
        for r in lot_data
    ]
    return PickerProductDetailResponse(
        product_id=product.id,
        name=product.name,
        main_barcode=main_barcode,
        locations=locations,
    )
