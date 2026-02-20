from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import case, distinct, exists, func, select
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import get_current_user, require_permission
from app.services.audit_service import ACTION_CREATE, get_client_ip, log_action

from app.api.v1.endpoints import picker_inventory
from app.db import get_db
from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.location import Location as LocationModel
from app.models.product import Product as ProductModel
from app.models.product import ProductBarcode
from app.models.stock import ON_HAND_MOVEMENT_TYPES
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.models.user import User as UserModel

router = APIRouter()

MOVEMENT_TYPES = {
    "opening_balance",
    "receipt",
    "putaway",
    "allocate",
    "unallocate",
    "pick",
    "ship",
    "adjust",
    "transfer_in",
    "transfer_out",
}


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
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    lot_id: UUID
    location_id: UUID
    qty_change: Decimal
    movement_type: str
    source_document_type: Optional[str] = None
    source_document_id: Optional[UUID] = None
    created_at: datetime
    created_by_user_id: Optional[UUID] = None


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


class BalanceMovementItem(BaseModel):
    """Bitta harakat – diagnostika uchun."""
    movement_type: str
    qty_change: Decimal
    created_at: datetime
    source_document_type: Optional[str] = None
    source_document_id: Optional[UUID] = None


class BalanceDiagnosticOut(BaseModel):
    """Mahsulot qoldiqining sababi – barcha harakatlar va hisoblash."""
    product_id: UUID
    sku: str
    name: str
    on_hand: Decimal
    reserved: Decimal
    available: Decimal
    movements: List[BalanceMovementItem]
    summary: str


class InventorySummaryRow(BaseModel):
    product_id: UUID
    product_code: str
    name: str
    on_hand_total: Decimal
    reserved_total: Decimal
    available_total: Decimal
    lots_count: int
    locations_count: int


class InventoryDetailRow(BaseModel):
    product_id: UUID
    lot_id: UUID
    batch: str
    expiry_date: Optional[date] = None
    location_id: UUID
    location_code: str
    location_type: Optional[str] = None
    sector: Optional[str] = None
    location_path: str
    on_hand: Decimal
    reserved: Decimal
    available: Decimal


class InventoryByLocationRow(BaseModel):
    """One row per (product, lot) at a location – for location detail page."""
    product_id: UUID
    product_code: str
    product_name: str
    barcode: Optional[str] = None
    brand: Optional[str] = None
    lot_id: UUID
    batch: str
    expiry_date: Optional[date] = None
    on_hand: Decimal
    available: Decimal


class InventorySummaryWithLocationRow(BaseModel):
    """One row per (product, location) for inventory table with expandable location rows."""
    product_id: UUID
    product_code: str
    name: str
    brand: Optional[str] = None
    on_hand: Decimal
    reserved: Decimal
    available: Decimal
    location_id: Optional[UUID] = None
    location_code: str
    location_type: Optional[str] = None
    sector: Optional[str] = None


class InventoryByProductRowEmbed(BaseModel):
    """Per-location row for embedding in summary."""
    location_code: str
    qty: Decimal
    available_qty: Decimal
    expiry_date: Optional[date] = None


class InventorySummaryLightRow(BaseModel):
    """Lightweight summary: product_id, name, brand, totals. Optional location breakdown."""
    product_id: UUID
    product_name: str
    product_code: str
    barcode: Optional[str] = None
    brand_name: Optional[str] = None
    total_qty: Decimal
    available_qty: Decimal
    locations: Optional[List[InventoryByProductRowEmbed]] = None


class InventorySummaryLightResponse(BaseModel):
    items: List[InventorySummaryLightRow]
    total: int
    limit: int
    offset: int


class InventoryByProductRow(BaseModel):
    """Per-location breakdown for one product. Load on row expand."""
    location_code: str
    location_type: Optional[str] = None
    qty: Decimal
    reserved_qty: Decimal
    available_qty: Decimal
    expiry_date: Optional[date] = None


def _build_location_path_map(locations: list[LocationModel]) -> dict[UUID, str]:
    by_id = {location.id: location for location in locations}
    cache: dict[UUID, str] = {}

    def _path(location_id: UUID) -> str:
        if location_id in cache:
            return cache[location_id]
        location = by_id.get(location_id)
        if not location:
            return ""
        if location.parent_id:
            parent_path = _path(location.parent_id)
            path = f"{parent_path} / {location.code}" if parent_path else location.code
        else:
            path = location.code
        cache[location_id] = path
        return path

    for location_id in by_id:
        _path(location_id)
    return cache


def _descendant_location_ids(db: Session, root_id: UUID) -> list[UUID]:
    location_cte = select(LocationModel.id).where(LocationModel.id == root_id).cte(recursive=True)
    location_cte = location_cte.union_all(
        select(LocationModel.id).where(LocationModel.parent_id == location_cte.c.id)
    )
    return [row[0] for row in db.execute(select(location_cte.c.id)).all()]


def _apply_product_search(query, search: str):
    term = f"%{search.strip()}%"
    barcode_exists = (
        exists()
        .where(ProductBarcode.product_id == ProductModel.id)
        .where(ProductBarcode.barcode.ilike(term))
    )
    return query.filter(
        func.lower(ProductModel.name).ilike(func.lower(term))
        | func.lower(ProductModel.sku).ilike(func.lower(term))
        | barcode_exists
    )


def _to_lot(lot: StockLotModel) -> StockLotOut:
    return StockLotOut(
        id=lot.id,
        product_id=lot.product_id,
        batch=lot.batch,
        expiry_date=lot.expiry_date,
        created_at=lot.created_at,
    )


def _to_movement(movement: StockMovementModel) -> StockMovementOut:
    product = getattr(movement, "product", None)
    return StockMovementOut(
        id=movement.id,
        product_id=movement.product_id,
        product_code=product.sku if product else None,
        product_name=product.name if product else None,
        lot_id=movement.lot_id,
        location_id=movement.location_id,
        qty_change=movement.qty_change,
        movement_type=movement.movement_type,
        source_document_type=movement.source_document_type,
        source_document_id=movement.source_document_id,
        created_at=movement.created_at,
        created_by_user_id=movement.created_by_user_id,
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
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    source_document_type: Optional[str] = None,
    source_document_id: Optional[UUID] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("movements:read")),
):
    query = db.query(StockMovementModel)
    if product_id:
        query = query.filter(StockMovementModel.product_id == product_id)
    if lot_id:
        query = query.filter(StockMovementModel.lot_id == lot_id)
    if location_id:
        query = query.filter(StockMovementModel.location_id == location_id)
    if movement_type:
        tokens = [token.strip() for token in movement_type.split(",") if token.strip()]
        query = query.filter(StockMovementModel.movement_type.in_(tokens))
    if date_from:
        query = query.filter(func.date(StockMovementModel.created_at) >= date_from)
    if date_to:
        query = query.filter(func.date(StockMovementModel.created_at) <= date_to)
    if source_document_type:
        query = query.filter(StockMovementModel.source_document_type == source_document_type)
    if source_document_id:
        query = query.filter(StockMovementModel.source_document_id == source_document_id)

    movements = (
        query.options(selectinload(StockMovementModel.product))
        .order_by(StockMovementModel.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_to_movement(movement) for movement in movements]


@router.post("/movements", response_model=StockMovementOut, status_code=status.HTTP_201_CREATED)
@router.post("/movements/", response_model=StockMovementOut, status_code=status.HTTP_201_CREATED)
async def create_stock_movement(
    request: Request,
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
        created_by_user_id=user.id,
    )
    db.add(movement)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_CREATE,
        entity_type="stock_movement",
        entity_id=str(movement.id),
        new_data={
            "product_id": str(payload.product_id),
            "lot_id": str(payload.lot_id),
            "location_id": str(payload.location_id),
            "qty_change": str(payload.qty_change),
            "movement_type": payload.movement_type,
        },
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(movement)
    return _to_movement(movement)


@router.get("/summary", response_model=List[InventorySummaryRow], summary="Inventory summary")
@router.get("/summary/", response_model=List[InventorySummaryRow], summary="Inventory summary")
async def inventory_summary(
    search: Optional[str] = None,
    product_ids: Optional[str] = Query(default=None, description="Comma-separated product UUIDs"),
    only_available: bool = Query(False),
    low_stock_threshold: Optional[Decimal] = Query(default=None, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    # Qoldiq: faqat Kirim (receipt) va Jo'natish (ship)
    on_hand_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(ON_HAND_MOVEMENT_TYPES), StockMovementModel.qty_change),
            else_=0,
        )
    )
    reserved_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(("allocate", "unallocate")), StockMovementModel.qty_change),
            else_=0,
        )
    )

    query = (
        db.query(
            ProductModel.id.label("product_id"),
            ProductModel.sku.label("product_code"),
            ProductModel.name.label("name"),
            on_hand_expr.label("on_hand_total"),
            reserved_expr.label("reserved_total"),
            (on_hand_expr - reserved_expr).label("available_total"),
            func.count(distinct(StockMovementModel.lot_id)).label("lots_count"),
            func.count(distinct(StockMovementModel.location_id)).label("locations_count"),
        )
        .join(StockLotModel, StockLotModel.product_id == ProductModel.id)
        .join(StockMovementModel, StockMovementModel.lot_id == StockLotModel.id)
        .group_by(ProductModel.id, ProductModel.sku, ProductModel.name)
    )

    if search:
        query = _apply_product_search(query, search)
    if product_ids:
        ids = [UUID(token.strip()) for token in product_ids.split(",") if token.strip()]
        if ids:
            query = query.filter(ProductModel.id.in_(ids))
    if only_available:
        query = query.having(on_hand_expr - reserved_expr > 0)
    if low_stock_threshold is not None:
        query = query.having(on_hand_expr <= low_stock_threshold)

    rows = query.order_by(ProductModel.sku.asc()).all()
    return [InventorySummaryRow(**row._asdict()) for row in rows]


def _fetch_locations_by_products(db: Session, product_ids: list[UUID]) -> dict[UUID, list]:
    """Fetch per-location breakdown for given product_ids. Returns {product_id: [rows]}."""
    if not product_ids:
        return {}
    on_hand_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(ON_HAND_MOVEMENT_TYPES), StockMovementModel.qty_change),
            else_=0,
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
    available_expr = on_hand_expr - reserved_expr
    rows = (
        db.query(
            StockLotModel.product_id,
            LocationModel.code.label("location_code"),
            on_hand_expr.label("qty"),
            available_expr.label("available_qty"),
            StockLotModel.expiry_date.label("expiry_date"),
        )
        .join(StockMovementModel, StockMovementModel.lot_id == StockLotModel.id)
        .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
        .filter(StockLotModel.product_id.in_(product_ids))
        .group_by(
            StockLotModel.product_id,
            StockMovementModel.location_id,
            LocationModel.code,
            StockLotModel.id,
            StockLotModel.expiry_date,
        )
        .having(available_expr != 0)
        .order_by(StockLotModel.product_id, LocationModel.code.asc(), StockLotModel.expiry_date.asc().nullslast())
        .all()
    )
    result: dict[UUID, list] = {pid: [] for pid in product_ids}
    for r in rows:
        result[r.product_id].append(
            {
                "location_code": r.location_code,
                "qty": r.qty,
                "available_qty": r.available_qty,
                "expiry_date": r.expiry_date,
            }
        )
    return result


@router.get("/summary-light", response_model=InventorySummaryLightResponse, summary="Lightweight inventory summary (paginated)")
@router.get("/summary-light/", response_model=InventorySummaryLightResponse, summary="Lightweight inventory summary (paginated)")
async def inventory_summary_light(
    search: Optional[str] = None,
    only_available: bool = Query(True, description="Default true for fast load"),
    include_locations: bool = Query(True, description="Include location breakdown per product"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    """Lightweight summary: product_id, name, brand, totals. Optional location breakdown. Paginated."""
    on_hand_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(ON_HAND_MOVEMENT_TYPES), StockMovementModel.qty_change),
            else_=0,
        )
    )
    reserved_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(("allocate", "unallocate")), StockMovementModel.qty_change),
            else_=0,
        )
    )
    available_expr = on_hand_expr - reserved_expr

    barcode_subq = (
        select(ProductBarcode.barcode)
        .where(ProductBarcode.product_id == ProductModel.id)
        .limit(1)
        .correlate(ProductModel)
        .scalar_subquery()
    )
    barcode_expr = func.coalesce(ProductModel.barcode, barcode_subq)
    base_query = (
        db.query(
            ProductModel.id.label("product_id"),
            ProductModel.name.label("product_name"),
            ProductModel.sku.label("product_code"),
            barcode_expr.label("barcode"),
            func.coalesce(ProductModel.brand, "").label("brand_name"),
            on_hand_expr.label("total_qty"),
            available_expr.label("available_qty"),
        )
        .join(StockLotModel, StockLotModel.product_id == ProductModel.id)
        .join(StockMovementModel, StockMovementModel.lot_id == StockLotModel.id)
        .group_by(ProductModel.id, ProductModel.name, ProductModel.sku, ProductModel.barcode, ProductModel.brand)
    )
    if search:
        base_query = _apply_product_search(base_query, search)
    if only_available:
        base_query = base_query.having(available_expr > 0)

    subq = base_query.subquery()
    total = db.execute(select(func.count()).select_from(subq)).scalar() or 0

    rows = (
        base_query.order_by(ProductModel.sku.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    product_ids = [row.product_id for row in rows]
    locs_map: dict[UUID, list] = {}
    if include_locations and product_ids:
        locs_map = _fetch_locations_by_products(db, product_ids)
    items = [
        InventorySummaryLightRow(
            product_id=row.product_id,
            product_name=row.product_name,
            product_code=row.product_code,
            barcode=row.barcode if row.barcode else None,
            brand_name=row.brand_name or None,
            total_qty=row.total_qty,
            available_qty=row.available_qty,
            locations=[
                InventoryByProductRowEmbed(
                    location_code=l["location_code"],
                    qty=l["qty"],
                    available_qty=l["available_qty"],
                    expiry_date=l["expiry_date"],
                )
                for l in locs_map.get(row.product_id, [])
            ]
            if include_locations
            else None,
        )
        for row in rows
    ]
    return InventorySummaryLightResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/by-product/{product_id}", response_model=List[InventoryByProductRow], summary="Location breakdown for one product")
async def inventory_by_product(
    product_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    """Per-location details for one product. Call when user expands row."""
    on_hand_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(ON_HAND_MOVEMENT_TYPES), StockMovementModel.qty_change),
            else_=0,
        )
    )
    reserved_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(("allocate", "unallocate")), StockMovementModel.qty_change),
            else_=0,
        )
    )
    available_expr = on_hand_expr - reserved_expr

    rows = (
        db.query(
            LocationModel.code.label("location_code"),
            LocationModel.location_type.label("location_type"),
            on_hand_expr.label("qty"),
            reserved_expr.label("reserved_qty"),
            available_expr.label("available_qty"),
            StockLotModel.expiry_date.label("expiry_date"),
        )
        .select_from(ProductModel)
        .join(StockLotModel, StockLotModel.product_id == ProductModel.id)
        .join(StockMovementModel, StockMovementModel.lot_id == StockLotModel.id)
        .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
        .filter(ProductModel.id == product_id)
        .group_by(
            StockMovementModel.location_id,
            LocationModel.code,
            LocationModel.location_type,
            StockLotModel.id,
            StockLotModel.expiry_date,
        )
        .having(on_hand_expr != 0)
        .order_by(LocationModel.code.asc(), StockLotModel.expiry_date.asc().nullslast())
        .all()
    )
    return [
        InventoryByProductRow(
            location_code=row.location_code,
            location_type=row.location_type,
            qty=row.qty,
            reserved_qty=row.reserved_qty,
            available_qty=row.available_qty,
            expiry_date=row.expiry_date,
        )
        for row in rows
    ]


@router.get("/details", response_model=List[InventoryDetailRow], summary="Inventory details")
@router.get("/details/", response_model=List[InventoryDetailRow], summary="Inventory details")
async def inventory_details(
    product_id: Optional[UUID] = None,
    location_id: Optional[UUID] = None,
    expiry_before: Optional[date] = None,
    show_zero: bool = Query(False),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    on_hand_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(ON_HAND_MOVEMENT_TYPES), StockMovementModel.qty_change),
            else_=0,
        )
    )
    reserved_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(("allocate", "unallocate")), StockMovementModel.qty_change),
            else_=0,
        )
    )

    query = (
        db.query(
            StockLotModel.product_id.label("product_id"),
            StockLotModel.id.label("lot_id"),
            StockLotModel.batch.label("batch"),
            StockLotModel.expiry_date.label("expiry_date"),
            StockMovementModel.location_id.label("location_id"),
            LocationModel.code.label("location_code"),
            LocationModel.location_type.label("location_type"),
            LocationModel.sector.label("sector"),
            on_hand_expr.label("on_hand"),
            reserved_expr.label("reserved"),
            (on_hand_expr - reserved_expr).label("available"),
        )
        .join(StockLotModel, StockLotModel.id == StockMovementModel.lot_id)
        .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
        .group_by(
            StockLotModel.product_id,
            StockLotModel.id,
            StockLotModel.batch,
            StockLotModel.expiry_date,
            StockMovementModel.location_id,
            LocationModel.code,
            LocationModel.location_type,
            LocationModel.sector,
        )
    )

    if product_id:
        query = query.filter(StockLotModel.product_id == product_id)
    if location_id:
        location_ids = _descendant_location_ids(db, location_id)
        if location_ids:
            query = query.filter(StockMovementModel.location_id.in_(location_ids))
    if expiry_before:
        query = query.filter(StockLotModel.expiry_date.is_not(None))
        query = query.filter(StockLotModel.expiry_date <= expiry_before)
    if not show_zero:
        query = query.having(on_hand_expr - reserved_expr != 0)

    rows = query.order_by(StockLotModel.expiry_date.asc().nullslast()).all()
    location_map = _build_location_path_map(db.query(LocationModel).all())
    return [
        InventoryDetailRow(
            product_id=row.product_id,
            lot_id=row.lot_id,
            batch=row.batch,
            expiry_date=row.expiry_date,
            location_id=row.location_id,
            location_code=row.location_code,
            location_type=row.location_type,
            sector=row.sector,
            location_path=location_map.get(row.location_id, row.location_code),
            on_hand=row.on_hand,
            reserved=row.reserved,
            available=row.available,
        )
        for row in rows
    ]


@router.get(
    "/by-location/{location_id}",
    response_model=List[InventoryByLocationRow],
    summary="Inventory at a location (product code, barcode, brand, expiry, qty)",
)
async def inventory_by_location(
    location_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    """List all product lots at the given location with product code, name, barcode, brand, expiry, qty."""
    on_hand_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(ON_HAND_MOVEMENT_TYPES), StockMovementModel.qty_change),
            else_=0,
        )
    )
    reserved_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(("allocate", "unallocate")), StockMovementModel.qty_change),
            else_=0,
        )
    )
    available_expr = on_hand_expr - reserved_expr

    rows = (
        db.query(
            ProductModel.id.label("product_id"),
            ProductModel.sku.label("product_code"),
            ProductModel.name.label("product_name"),
            ProductModel.barcode.label("barcode"),
            ProductModel.brand.label("brand"),
            StockLotModel.id.label("lot_id"),
            StockLotModel.batch.label("batch"),
            StockLotModel.expiry_date.label("expiry_date"),
            on_hand_expr.label("on_hand"),
            available_expr.label("available"),
        )
        .select_from(StockMovementModel)
        .join(StockLotModel, StockLotModel.id == StockMovementModel.lot_id)
        .join(ProductModel, ProductModel.id == StockLotModel.product_id)
        .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
        .filter(StockMovementModel.location_id == location_id)
        .group_by(
            ProductModel.id,
            ProductModel.sku,
            ProductModel.name,
            ProductModel.barcode,
            ProductModel.brand,
            StockLotModel.id,
            StockLotModel.batch,
            StockLotModel.expiry_date,
        )
        .having(on_hand_expr != 0)
        .order_by(ProductModel.sku.asc(), StockLotModel.expiry_date.asc().nullslast())
        .all()
    )
    return [
        InventoryByLocationRow(
            product_id=row.product_id,
            product_code=row.product_code,
            product_name=row.product_name,
            barcode=row.barcode,
            brand=row.brand or None,
            lot_id=row.lot_id,
            batch=row.batch,
            expiry_date=row.expiry_date,
            on_hand=row.on_hand,
            available=row.available,
        )
        for row in rows
    ]


@router.get(
    "/summary-by-location",
    response_model=List[InventorySummaryWithLocationRow],
    summary="Inventory summary per product and location (for table with Location column)",
)
@router.get(
    "/summary-by-location/",
    response_model=List[InventorySummaryWithLocationRow],
    summary="Inventory summary per product and location",
)
async def inventory_summary_by_location(
    search: Optional[str] = None,
    product_ids: Optional[str] = Query(default=None, description="Comma-separated product UUIDs"),
    only_available: bool = Query(False),
    include_all_products: bool = Query(
        False,
        description="Include Smartup products with zero stock (for entering qoldiq/location)",
    ),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    on_hand_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(ON_HAND_MOVEMENT_TYPES), StockMovementModel.qty_change),
            else_=0,
        )
    )
    reserved_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(("allocate", "unallocate")), StockMovementModel.qty_change),
            else_=0,
        )
    )
    available_expr = on_hand_expr - reserved_expr

    query = (
        db.query(
            ProductModel.id.label("product_id"),
            ProductModel.sku.label("product_code"),
            ProductModel.name.label("name"),
            func.coalesce(ProductModel.brand, "").label("brand"),
            on_hand_expr.label("on_hand"),
            reserved_expr.label("reserved"),
            available_expr.label("available"),
            LocationModel.id.label("location_id"),
            LocationModel.code.label("location_code"),
            LocationModel.location_type.label("location_type"),
            LocationModel.sector.label("sector"),
        )
        .join(StockLotModel, StockLotModel.product_id == ProductModel.id)
        .join(StockMovementModel, StockMovementModel.lot_id == StockLotModel.id)
        .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
        .group_by(
            ProductModel.id,
            ProductModel.sku,
            ProductModel.name,
            ProductModel.brand,
            LocationModel.id,
            LocationModel.code,
            LocationModel.location_type,
            LocationModel.sector,
        )
        .having(available_expr != 0)
    )
    if search:
        query = _apply_product_search(query, search)
    if product_ids:
        ids = [UUID(token.strip()) for token in product_ids.split(",") if token.strip()]
        if ids:
            query = query.filter(ProductModel.id.in_(ids))
    if only_available:
        query = query.having(available_expr > 0)

    rows = query.order_by(ProductModel.sku.asc(), LocationModel.code.asc()).all()
    result = [
        InventorySummaryWithLocationRow(
            product_id=row.product_id,
            product_code=row.product_code,
            name=row.name,
            brand=row.brand or None,
            on_hand=row.on_hand,
            reserved=row.reserved,
            available=row.available,
            location_id=row.location_id,
            location_code=row.location_code,
            location_type=row.location_type,
            sector=row.sector,
        )
        for row in rows
    ]

    if include_all_products:
        products_query = db.query(
            ProductModel.id,
            ProductModel.sku,
            ProductModel.name,
            ProductModel.brand,
        )
        if search:
            products_query = _apply_product_search(products_query, search)
        if product_ids:
            ids = [UUID(t.strip()) for t in product_ids.split(",") if t.strip()]
            if ids:
                products_query = products_query.filter(ProductModel.id.in_(ids))
        products_query = products_query.order_by(ProductModel.sku.asc())
        all_products = products_query.all()
        have_stock_ids = {r.product_id for r in rows}
        for p in all_products:
            if p.id not in have_stock_ids:
                result.append(
                    InventorySummaryWithLocationRow(
                        product_id=p.id,
                        product_code=p.sku,
                        name=p.name,
                        brand=p.brand or None,
                        on_hand=Decimal("0"),
                        reserved=Decimal("0"),
                        available=Decimal("0"),
                        location_id=None,
                        location_code="—",
                        location_type=None,
                        sector=None,
                    )
                )
        result.sort(key=lambda r: (r.product_code, r.location_code or ""))

    return result


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
    qty_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(ON_HAND_MOVEMENT_TYPES), StockMovementModel.qty_change),
            else_=0,
        )
    )
    query = (
        db.query(
            StockMovementModel.lot_id,
            StockMovementModel.location_id,
            qty_expr.label("qty"),
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
        query = query.having(qty_expr != 0)

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


@router.get(
    "/balance-diagnostic",
    response_model=BalanceDiagnosticOut,
    summary="Mahsulot qoldiqining sababi (SKU bo'yicha)",
)
async def balance_diagnostic(
    sku: str = Query(..., description="Mahsulot kodi, masalan C0037"),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    """
    Berilgan SKU (masalan C0037) bo'yicha barcha stock harakatlarini va
    on_hand/reserved/available hisoblashini qaytaradi. Qoldiq nega shunday ekanini aniqlash uchun.
    """
    product = (
        db.query(ProductModel)
        .filter(func.upper(ProductModel.sku) == func.upper(sku.strip()))
        .one_or_none()
    )
    if not product:
        raise HTTPException(status_code=404, detail=f"Mahsulot topilmadi: {sku}")

    movements = (
        db.query(StockMovementModel)
        .filter(StockMovementModel.product_id == product.id)
        .order_by(StockMovementModel.created_at.asc())
        .all()
    )

    # Qoldiq: faqat Kirim (receipt) va Jo'natish (ship)
    on_hand = sum(
        (m.qty_change for m in movements if m.movement_type in ON_HAND_MOVEMENT_TYPES),
        Decimal("0"),
    )
    reserved = sum(
        (m.qty_change for m in movements if m.movement_type in ("allocate", "unallocate")),
        Decimal("0"),
    )
    available = on_hand - reserved

    items = [
        BalanceMovementItem(
            movement_type=m.movement_type,
            qty_change=m.qty_change,
            created_at=m.created_at,
            source_document_type=m.source_document_type,
            source_document_id=m.source_document_id,
        )
        for m in movements
    ]

    # Qisqacha tushuntirish
    receipt_sum = sum(m.qty_change for m in movements if m.movement_type == "receipt")
    pick_sum = sum(m.qty_change for m in movements if m.movement_type == "pick")
    pick_count = sum(1 for m in movements if m.movement_type == "pick")
    ship_sum = sum(m.qty_change for m in movements if m.movement_type == "ship")
    summary = (
        f"Qoldiq hisobi: faqat Kirim (receipt) va Jo'natish (ship). "
        f"Kirim: {receipt_sum}, Jo'natish: {ship_sum} → on_hand={on_hand}, reserved={reserved}, available={available}."
    )
    if pick_count >= 2:
        summary += (
            f" Eslatma: {pick_count} ta terish (pick) yozuvi bor; qoldiqda faqat receipt+ship hisoblanadi."
        )

    return BalanceDiagnosticOut(
        product_id=product.id,
        sku=product.sku,
        name=product.name,
        on_hand=on_hand,
        reserved=reserved,
        available=available,
        movements=items,
        summary=summary,
    )


class FixDuplicatePickRequest(BaseModel):
    """Mahsulot bo'yicha ortiqcha (takroriy) pick yozuvini tuzatish."""
    product_id: UUID
    document_id: Optional[UUID] = None


class FixDuplicatePickResponse(BaseModel):
    fixed: bool
    message: str
    removed_pick_id: Optional[UUID] = None
    removed_unallocate_id: Optional[UUID] = None


@router.post(
    "/fix-duplicate-pick",
    response_model=FixDuplicatePickResponse,
    summary="Takroriy pick tuzatish (admin)",
)
async def fix_duplicate_pick(
    body: FixDuplicatePickRequest,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:adjust")),
):
    """
    Bir xil hujjat/mahsulot/lot/joy uchun ortiqcha yozilgan pick+unallocate juftini o'chiradi.
    10 kirim, 1 terish kerak, lekin 2 ta pick yozilgan bo'lsa qoldiq 8 ko'rinadi; bitta ortiqcha juftni o'chiramiz.
    """
    # Hujjat bo'yicha (product, lot, location) guruhlarda pick sum va max_required hisoblash
    pick_sum_q = (
        db.query(
            StockMovementModel.source_document_id,
            StockMovementModel.product_id,
            StockMovementModel.lot_id,
            StockMovementModel.location_id,
            func.sum(StockMovementModel.qty_change).label("total_pick"),
        )
        .filter(
            StockMovementModel.movement_type == "pick",
            StockMovementModel.source_document_type == "document",
            StockMovementModel.product_id == body.product_id,
        )
    )
    if body.document_id is not None:
        pick_sum_q = pick_sum_q.filter(StockMovementModel.source_document_id == body.document_id)
    pick_rows = pick_sum_q.group_by(
        StockMovementModel.source_document_id,
        StockMovementModel.product_id,
        StockMovementModel.lot_id,
        StockMovementModel.location_id,
    ).all()

    for row in pick_rows:
        doc_id = row.source_document_id
        if doc_id is None:
            continue
        total_pick = float(row.total_pick or 0)
        # Hujjatdagi shu (product, lot, location) bo'yicha kerak miqdor
        max_required = (
            db.query(func.coalesce(func.sum(DocumentLineModel.required_qty), 0))
            .filter(
                DocumentLineModel.document_id == doc_id,
                DocumentLineModel.product_id == row.product_id,
                DocumentLineModel.lot_id == row.lot_id,
                DocumentLineModel.location_id == row.location_id,
            )
            .scalar()
        )
        max_required = float(max_required or 0)
        # total_pick manfiy (masalan -2); kerak -max_required dan katta yoki teng (masalan -1)
        if total_pick >= -max_required:
            continue
        # Ortiqcha terilgan: eng oxirgi pick va unallocate ni o'chiramiz
        last_pick = (
            db.query(StockMovementModel)
            .filter(
                StockMovementModel.movement_type == "pick",
                StockMovementModel.source_document_type == "document",
                StockMovementModel.source_document_id == doc_id,
                StockMovementModel.product_id == row.product_id,
                StockMovementModel.lot_id == row.lot_id,
                StockMovementModel.location_id == row.location_id,
            )
            .order_by(StockMovementModel.created_at.desc())
            .first()
        )
        last_unallocate = (
            db.query(StockMovementModel)
            .filter(
                StockMovementModel.movement_type == "unallocate",
                StockMovementModel.source_document_type == "document",
                StockMovementModel.source_document_id == doc_id,
                StockMovementModel.product_id == row.product_id,
                StockMovementModel.lot_id == row.lot_id,
                StockMovementModel.location_id == row.location_id,
            )
            .order_by(StockMovementModel.created_at.desc())
            .first()
        )
        if last_pick and last_unallocate:
            pick_id, unalloc_id = last_pick.id, last_unallocate.id
            db.delete(last_pick)
            db.delete(last_unallocate)
            db.commit()
            return FixDuplicatePickResponse(
                fixed=True,
                message="Ortiqcha terish yozuvi o'chirildi. Qoldiq endi to'g'ri hisoblanadi.",
                removed_pick_id=pick_id,
                removed_unallocate_id=unalloc_id,
            )

    return FixDuplicatePickResponse(
        fixed=False,
        message="Ortiqcha pick topilmadi yoki allaqachon to'g'ri.",
    )


router.include_router(picker_inventory.router)
