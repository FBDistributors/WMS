from __future__ import annotations

import asyncio
import hashlib
import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, List, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Query, Header, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, distinct, exists, func, or_, select
from sqlalchemy.orm import Session, aliased, selectinload
from sqlalchemy.exc import IntegrityError

from app.auth.deps import get_current_user, require_permission
from app.auth.guards import check_controller_adjust_reason
from app.core.stock_rules import check_location_single_expiry
from app.services.audit_service import ACTION_CREATE, get_client_ip, log_action
from app.services.stock_availability import (
    compute_lot_location_balances,
    lock_lot_location,
    require_sufficient_available,
    require_sufficient_reserved,
)

from app.api.v1.endpoints import picker_inventory
from app.api.v1.endpoints.picker_inventory import _get_lot_level_balances
from app.db import get_db
from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.brand import Brand as BrandModel
from app.models.location import Location as LocationModel
from app.models.idempotency_key import IdempotencyKey as IdempotencyKeyModel
from app.models.order import Order as OrderModel
from app.models.product import Product as ProductModel
from app.models.product import ProductBarcode
from app.models.stock import ON_HAND_MOVEMENT_TYPES
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.models.user import User as UserModel
from app.integrations.smartup import balance_export as smartup_balance_export
from app.integrations.smartup.balance_disk_cache import (
    read_balance_cache as read_smartup_balance_disk_cache,
    write_balance_cache as write_smartup_balance_disk_cache,
)
from app.integrations.smartup.filial_list import FILIAL_LIST, get_filial_ids

router = APIRouter()

# SmartUP balance cache: (today_str, warehouse_code, filial_id) -> result
_smartup_balance_cache: dict[tuple[str, str, str], Any] = {}


def _get_showroom_root_id(db: Session) -> Optional[UUID]:
    """Return the id of the Showroom warehouse root location, or None if not found."""
    row = (
        db.query(LocationModel.id)
        .filter(LocationModel.code == "SHOWROOM", LocationModel.type == "warehouse")
        .one_or_none()
    )
    return row[0] if row else None


def _location_ids_for_warehouse(db: Session, warehouse: Optional[str]) -> Optional[List[UUID]]:
    """Return list of location ids for the given warehouse (main or showroom), or None for no filter."""
    if not warehouse or warehouse not in ("main", "showroom"):
        return None
    if warehouse == "main":
        rows = (
            db.query(LocationModel.id)
            .filter(LocationModel.warehouse_id.is_(None), LocationModel.type != "warehouse")
            .all()
        )
        return [r[0] for r in rows]
    showroom_id = _get_showroom_root_id(db)
    if showroom_id is None:
        return []
    rows = db.query(LocationModel.id).filter(LocationModel.warehouse_id == showroom_id).all()
    return [r[0] for r in rows]


def _product_ids_with_positive_net_reserved(
    db: Session, location_ids: Optional[List[UUID]]
) -> set[UUID]:
    """
    Mahsulot bo'yicha allocate/unallocate yig'indisi > 0 bo'lgan product_id lar.
    list_reserve_by_order va reserve_stuck_summary bir xil filtr — aks holda "soxta" qatorlar
    (bir buyurtmada +, boshqasida - yig'indisi 0) bannerda qolib ketadi.
    """
    tot_q = (
        db.query(
            StockMovementModel.product_id,
            func.sum(StockMovementModel.qty_change).label("reserved_total"),
        )
        .filter(StockMovementModel.movement_type.in_(("allocate", "unallocate")))
    )
    if location_ids is not None:
        tot_q = tot_q.filter(StockMovementModel.location_id.in_(location_ids))
    out: set[UUID] = set()
    for pr in tot_q.group_by(StockMovementModel.product_id).all():
        rt = pr.reserved_total
        if rt is not None and rt > 0:
            out.add(pr.product_id)
    return out


def _resolve_product_by_sku_or_barcode(db: Session, code: str) -> Optional[ProductModel]:
    """SKU (exact) first, then primary/extra barcodes (exact). Active products only."""
    code = (code or "").strip()
    if not code:
        return None
    by_sku = (
        db.query(ProductModel)
        .options(selectinload(ProductModel.barcodes))
        .filter(ProductModel.is_active.is_(True), ProductModel.sku == code)
        .first()
    )
    if by_sku:
        return by_sku
    return (
        db.query(ProductModel)
        .options(selectinload(ProductModel.barcodes))
        .filter(
            ProductModel.is_active.is_(True),
            or_(
                ProductModel.barcode == code,
                ProductModel.id.in_(select(ProductBarcode.product_id).where(ProductBarcode.barcode == code)),
            ),
        )
        .first()
    )


def _resolve_location_by_code(db: Session, code: str) -> Optional[LocationModel]:
    c = (code or "").strip()
    if not c:
        return None
    return (
        db.query(LocationModel)
        .filter(LocationModel.code == c, LocationModel.is_active.is_(True))
        .one_or_none()
    )


def _resolve_import_brand_ref(db: Session, raw: Optional[str]) -> tuple[Optional[UUID], Optional[str]]:
    """
    Excel import: brand column may be UUID (brands.id) or human-readable code (brands.code), e.g. '006'.
    Returns (resolved_brand_id, error_message). Empty input -> (None, None).
    """
    if raw is None:
        return None, None
    s = str(raw).strip()
    if not s:
        return None, None
    try:
        uid = UUID(s)
    except ValueError:
        uid = None
    if uid is not None:
        brand = (
            db.query(BrandModel)
            .filter(BrandModel.id == uid, BrandModel.is_active.is_(True))
            .one_or_none()
        )
        if brand:
            return uid, None
        return None, "brand_id not found or inactive"
    brand = (
        db.query(BrandModel)
        .filter(BrandModel.code == s, BrandModel.is_active.is_(True))
        .one_or_none()
    )
    if brand:
        return brand.id, None
    return None, "brand_id not found or inactive"


def _ensure_lot_for_import(db: Session, product_id: UUID, expiry_date: Optional[date]) -> StockLotModel:
    """OPENING + null expiry vs IMPORT + dated expiry (matches import-qty / stock rules)."""
    if expiry_date is None:
        batch = BULK_OPENING_BATCH
        lot = (
            db.query(StockLotModel)
            .filter(
                StockLotModel.product_id == product_id,
                StockLotModel.batch == batch,
                StockLotModel.expiry_date.is_(None),
            )
            .first()
        )
        exp_val = None
    else:
        batch = IMPORT_BATCH
        lot = (
            db.query(StockLotModel)
            .filter(
                StockLotModel.product_id == product_id,
                StockLotModel.batch == batch,
                StockLotModel.expiry_date == expiry_date,
            )
            .first()
        )
        exp_val = expiry_date
    if not lot:
        lot = StockLotModel(
            product_id=product_id,
            batch=batch,
            expiry_date=exp_val,
        )
        db.add(lot)
        db.flush()
    return lot


def _location_valid_for_warehouse(
    db: Session, location: LocationModel, warehouse: Optional[str]
) -> bool:
    """When warehouse is set, location must belong to that warehouse and be a real bin (not root)."""
    if not warehouse or warehouse not in ("main", "showroom"):
        return True
    if not location.is_active or location.type == "warehouse":
        return False
    if warehouse == "main":
        return location.warehouse_id is None
    showroom_id = _get_showroom_root_id(db)
    if showroom_id is None:
        return False
    return location.warehouse_id == showroom_id


# On-hand only (zone implementation / Variant A); allocate/unallocate not in ledger
MOVEMENT_TYPES = set(ON_HAND_MOVEMENT_TYPES)
PHYSICAL_ON_HAND_MOVEMENT_TYPES = tuple(
    movement for movement in ON_HAND_MOVEMENT_TYPES if movement not in ("allocate", "unallocate")
)

_IDEMPOTENCY_TTL_HOURS = 24


def _verify_non_negative_balances_or_raise(
    db: Session,
    rows: list[tuple[UUID, UUID]],
) -> None:
    """
    rows: list[(lot_id, location_id)].
    Har bir juftlik uchun on_hand/reserved/available >= 0 bo'lishi shart.
    """
    bad: list[str] = []
    seen: set[tuple[UUID, UUID]] = set()
    for lot_id, location_id in rows:
        key = (lot_id, location_id)
        if key in seen:
            continue
        seen.add(key)
        on_hand, reserved, available = compute_lot_location_balances(db, lot_id, location_id)
        if on_hand < 0 or reserved < 0 or available < 0:
            bad.append(
                f"lot={lot_id}, location={location_id}, on_hand={on_hand}, reserved={reserved}, available={available}"
            )
    if bad:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Negative balance detected after operation",
                "rows": bad[:20],
            },
        )


def _idempotency_payload_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _run_with_idempotency(
    *,
    db: Session,
    user_id: UUID,
    key: str | None,
    scope: str,
    payload: dict[str, Any],
    expected_status: int,
    run: callable,
):
    if key is None or not key.strip():
        return run()

    clean_key = key.strip()
    req_hash = _idempotency_payload_hash(payload)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    existing = (
        db.query(IdempotencyKeyModel)
        .filter(
            IdempotencyKeyModel.scope == scope,
            IdempotencyKeyModel.user_id == user_id,
            IdempotencyKeyModel.key == clean_key,
        )
        .one_or_none()
    )
    if existing is not None and existing.expires_at >= now_utc:
        if existing.request_hash != req_hash:
            raise HTTPException(status_code=409, detail="Idempotency-Key already used with different payload")
        if existing.response_status == 0 or not existing.response_body:
            raise HTTPException(status_code=409, detail="Duplicate request in progress. Try again.")
        return JSONResponse(status_code=existing.response_status, content=json.loads(existing.response_body))
    if existing is not None and existing.expires_at < now_utc:
        db.delete(existing)
        db.flush()

    idem = IdempotencyKeyModel(
        key=clean_key,
        scope=scope,
        user_id=user_id,
        request_hash=req_hash,
        response_status=0,
        response_body="",
        expires_at=now_utc + timedelta(hours=_IDEMPOTENCY_TTL_HOURS),
    )
    db.add(idem)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Duplicate request in progress. Try again.")

    result = run()
    if isinstance(result, BaseModel):
        body = result.model_dump(mode="json")
    else:
        body = result
    idem.response_status = expected_status
    idem.response_body = json.dumps(body, ensure_ascii=False, default=str)
    db.commit()
    return JSONResponse(status_code=expected_status, content=body)


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


BULK_OPENING_BATCH = "OPENING"
IMPORT_BATCH = "IMPORT"


class BulkOpeningBalanceRequest(BaseModel):
    location_id: UUID
    qty: Decimal = Field(..., gt=0, description="Quantity per product")
    product_ids: Optional[List[UUID]] = Field(default=None, description="If empty, all active products")


class BulkOpeningBalanceResponse(BaseModel):
    created_count: int
    skipped_count: int
    errors: List[str] = []


class ImportQtyLineIn(BaseModel):
    code: str = Field(..., min_length=1, max_length=128)
    qty: int = Field(..., gt=0, le=10_000_000)


class ImportQtyRequest(BaseModel):
    location_id: UUID
    lines: List[ImportQtyLineIn] = Field(..., min_length=1, max_length=5000)
    warehouse: Optional[Literal["main", "showroom"]] = None


class ImportQtyErrorItem(BaseModel):
    code: str
    message: str


class ImportQtyResponse(BaseModel):
    applied_rows: int
    skipped_rows: int
    errors: List[ImportQtyErrorItem] = []


class ImportQtyRowLineIn(BaseModel):
    code: str = Field(..., min_length=1, max_length=128)
    qty: int = Field(..., gt=0, le=10_000_000)
    location_code: str = Field(..., min_length=1, max_length=128)
    expiry_date: Optional[date] = None
    brand_id: Optional[str] = Field(
        None,
        max_length=128,
        description="Brand UUID (brands.id) or brand code (brands.code), e.g. 006",
    )


class ImportQtyRowsRequest(BaseModel):
    lines: List[ImportQtyRowLineIn] = Field(..., min_length=1, max_length=5000)
    warehouse: Optional[Literal["main", "showroom"]] = None


class StockMovementOut(BaseModel):
    id: UUID
    product_id: UUID
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    lot_id: UUID
    batch: Optional[str] = None
    location_id: UUID
    location_code: Optional[str] = None
    qty_change: Decimal
    movement_type: str
    reason_code: Optional[str] = None
    source_document_type: Optional[str] = None
    source_document_id: Optional[UUID] = None
    created_at: datetime
    created_by_user_id: Optional[UUID] = None
    created_by_username: Optional[str] = None


class ReserveHistoryRow(BaseModel):
    id: UUID
    movement_type: str
    qty_change: Decimal
    created_at: datetime
    created_by_user_id: Optional[UUID] = None
    created_by_username: Optional[str] = None
    source_document_type: Optional[str] = None
    source_document_id: Optional[UUID] = None
    product_id: UUID
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    location_id: UUID
    location_code: Optional[str] = None
    lot_id: UUID
    batch: Optional[str] = None
    order_id: Optional[UUID] = None
    order_number: Optional[str] = None
    doc_no: Optional[str] = None


class ReserveHistoryResponse(BaseModel):
    items: List[ReserveHistoryRow]
    total: int
    limit: int
    offset: int


class ReserveByOrderRow(BaseModel):
    product_id: UUID
    product_code: str
    product_name: str
    order_id: UUID
    order_number: Optional[str] = None
    reserved_qty: Decimal
    last_movement_at: datetime
    last_movement_by_user_id: Optional[UUID] = None
    last_movement_by_username: Optional[str] = None


class ReserveByOrderResponse(BaseModel):
    items: List[ReserveByOrderRow]


class ReserveStuckSampleRow(BaseModel):
    product_id: UUID
    product_code: str
    product_name: str
    order_id: UUID
    order_number: Optional[str] = None
    reserved_qty: Decimal
    last_movement_at: datetime
    age_hours: int
    last_movement_by_user_id: Optional[UUID] = None
    last_movement_by_username: Optional[str] = None


class ReserveStuckSummaryResponse(BaseModel):
    warehouse: Literal["main", "showroom"]
    age_hours: int
    stuck_orders_count: int
    stuck_products_count: int
    stuck_rows_count: int
    oldest_hours: int
    sample: List[ReserveStuckSampleRow]


class StockMovementCreate(BaseModel):
    product_id: UUID
    lot_id: UUID
    location_id: UUID
    qty_change: Decimal
    movement_type: str = Field(..., min_length=1, max_length=32)
    source_document_type: Optional[str] = Field(default=None, max_length=32)
    source_document_id: Optional[UUID] = None
    reason_code: Optional[str] = Field(default=None, max_length=64)


class LocationTransferIn(BaseModel):
    from_location_id: UUID
    to_location_id: UUID
    mode: Literal["full", "partial"] = "full"
    lines: list["LocationTransferLineIn"] = Field(default_factory=list)


class LocationTransferLineIn(BaseModel):
    product_id: UUID
    lot_id: UUID
    qty: Decimal = Field(..., gt=0)


class LocationTransferOut(BaseModel):
    lines_transferred: int
    movements_created: int
    lines_requested: int = 0


class BrandZeroStockResponse(BaseModel):
    brand_id: UUID
    products_affected: int
    lots_affected: int
    stock_movements_created: int
    reserve_movements_created: int
    reserve_lots_affected: int
    movements_created: int
    skipped: int = 0


class MainZeroStockResponse(BaseModel):
    warehouse: Literal["main"] = "main"
    mode: Literal["brand_only", "reserve_only", "brand_and_reserve"]
    products_affected: int
    lots_affected: int
    stock_movements_created: int
    reserve_movements_created: int
    reserve_lots_affected: int
    movements_created: int
    skipped: int = 0


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


class NegativeBalanceRow(BaseModel):
    product_id: UUID
    sku: str | None
    location_id: UUID
    location_code: str
    lot_id: UUID
    batch: str
    expiry_date: date | None
    on_hand: Decimal
    reserved: Decimal
    available: Decimal


class NegativeBalanceCheckOut(BaseModel):
    total_rows: int
    rows: list[NegativeBalanceRow]


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
    brand_id: Optional[UUID] = None
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


def _to_movement(
    movement: StockMovementModel,
    created_by_username: Optional[str] = None,
) -> StockMovementOut:
    product = getattr(movement, "product", None)
    lot = getattr(movement, "lot", None)
    location = getattr(movement, "location", None)
    return StockMovementOut(
        id=movement.id,
        product_id=movement.product_id,
        product_code=product.sku if product else None,
        product_name=product.name if product else None,
        lot_id=movement.lot_id,
        batch=lot.batch if lot else None,
        location_id=movement.location_id,
        location_code=location.code if location else None,
        qty_change=movement.qty_change,
        movement_type=movement.movement_type,
        reason_code=movement.reason_code,
        source_document_type=movement.source_document_type,
        source_document_id=movement.source_document_id,
        created_at=movement.created_at,
        created_by_user_id=movement.created_by_user_id,
        created_by_username=created_by_username,
    )


def _to_reserve_history_row(
    movement: StockMovementModel,
    *,
    created_by_username: Optional[str],
    order_id: Optional[UUID],
    order_number: Optional[str],
    doc_no: Optional[str],
) -> ReserveHistoryRow:
    product = getattr(movement, "product", None)
    lot = getattr(movement, "lot", None)
    location = getattr(movement, "location", None)
    return ReserveHistoryRow(
        id=movement.id,
        movement_type=movement.movement_type,
        qty_change=movement.qty_change,
        created_at=movement.created_at,
        created_by_user_id=movement.created_by_user_id,
        created_by_username=created_by_username,
        source_document_type=movement.source_document_type,
        source_document_id=movement.source_document_id,
        product_id=movement.product_id,
        product_code=product.sku if product else None,
        product_name=product.name if product else None,
        location_id=movement.location_id,
        location_code=location.code if location else None,
        lot_id=movement.lot_id,
        batch=lot.batch if lot else None,
        order_id=order_id,
        order_number=order_number,
        doc_no=doc_no,
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


@router.post(
    "/bulk-opening-balance",
    response_model=BulkOpeningBalanceResponse,
    status_code=status.HTTP_200_OK,
    summary="Set opening balance for many products at once",
)
@router.post(
    "/bulk-opening-balance/",
    response_model=BulkOpeningBalanceResponse,
    status_code=status.HTTP_200_OK,
    summary="Set opening balance for many products at once",
)
async def bulk_opening_balance(
    request: Request,
    payload: BulkOpeningBalanceRequest,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_permission("inventory:adjust")),
):
    """Barcha (yoki tanlangan) mahsulotlar uchun bitta joyda opening_balance harakati yozadi. Har bir mahsulot uchun OPENING partiya bo'yicha bitta yozuv."""
    location = (
        db.query(LocationModel.id).filter(LocationModel.id == payload.location_id).one_or_none()
    )
    if not location:
        raise HTTPException(status_code=400, detail="Location not found")

    if payload.product_ids:
        product_ids = list(payload.product_ids)
    else:
        product_ids = [
            row[0]
            for row in db.query(ProductModel.id)
            .filter(ProductModel.is_active.is_(True))
            .all()
        ]
    if not product_ids:
        return BulkOpeningBalanceResponse(created_count=0, skipped_count=0, errors=[])

    created_count = 0
    skipped_count = 0
    errors: List[str] = []

    for product_id in product_ids:
        try:
            check_location_single_expiry(db, payload.location_id, product_id, None)

            lot = (
                db.query(StockLotModel)
                .filter(
                    StockLotModel.product_id == product_id,
                    StockLotModel.batch == BULK_OPENING_BATCH,
                    StockLotModel.expiry_date.is_(None),
                )
                .first()
            )
            if not lot:
                lot = StockLotModel(
                    product_id=product_id,
                    batch=BULK_OPENING_BATCH,
                    expiry_date=None,
                )
                db.add(lot)
                db.flush()
            movement = StockMovementModel(
                product_id=product_id,
                lot_id=lot.id,
                location_id=payload.location_id,
                qty_change=payload.qty,
                movement_type="opening_balance",
                source_document_type=None,
                source_document_id=None,
                created_by_user_id=user.id,
                reason_code=None,
            )
            db.add(movement)
            log_action(
                db,
                user_id=user.id,
                action=ACTION_CREATE,
                entity_type="stock_movement",
                entity_id=str(movement.id),
                new_data={
                    "product_id": str(product_id),
                    "lot_id": str(lot.id),
                    "location_id": str(payload.location_id),
                    "qty_change": str(payload.qty),
                    "movement_type": "opening_balance",
                },
                ip_address=get_client_ip(request),
            )
            db.commit()
            created_count += 1
        except Exception as e:
            db.rollback()
            skipped_count += 1
            errors.append(f"{product_id}: {str(e)}")
            if len(errors) >= 20:
                errors.append("…")
                break

    return BulkOpeningBalanceResponse(
        created_count=created_count,
        skipped_count=skipped_count,
        errors=errors[:20],
    )


_MAX_IMPORT_QTY_ERRORS = 50


@router.post(
    "/import-qty",
    response_model=ImportQtyResponse,
    status_code=status.HTTP_200_OK,
    summary="Import positive stock adjustments from spreadsheet (SKU or barcode per line)",
)
@router.post(
    "/import-qty/",
    response_model=ImportQtyResponse,
    status_code=status.HTTP_200_OK,
    summary="Import positive stock adjustments from spreadsheet (SKU or barcode per line)",
)
async def import_inventory_qty(
    request: Request,
    payload: ImportQtyRequest,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_permission("inventory:adjust")),
):
    """
    Har bir qator uchun tanlangan joyga miqdor qo'shiladi (adjust + inventory_overage).
    Bir xil kod takrorlansa miqdorlar yig'iladi. OPENING partiyasi ishlatiladi.
    """
    location = db.query(LocationModel).filter(LocationModel.id == payload.location_id).one_or_none()
    if not location:
        raise HTTPException(status_code=400, detail="Location not found")
    if not _location_valid_for_warehouse(db, location, payload.warehouse):
        raise HTTPException(
            status_code=400,
            detail="Location is inactive, not a storage location, or does not match the selected warehouse",
        )

    merged: dict[str, int] = defaultdict(int)
    for line in payload.lines:
        key = line.code.strip()
        if not key:
            continue
        merged[key] += line.qty

    if not merged:
        raise HTTPException(status_code=400, detail="No valid lines after merging")

    applied_rows = 0
    skipped_rows = 0
    errors: List[ImportQtyErrorItem] = []

    for code, qty in merged.items():
        if len(errors) >= _MAX_IMPORT_QTY_ERRORS:
            break
        try:
            product = _resolve_product_by_sku_or_barcode(db, code)
            if not product:
                skipped_rows += 1
                errors.append(ImportQtyErrorItem(code=code, message="Product not found"))
                continue

            check_location_single_expiry(db, payload.location_id, product.id, None)

            lot = (
                db.query(StockLotModel)
                .filter(
                    StockLotModel.product_id == product.id,
                    StockLotModel.batch == BULK_OPENING_BATCH,
                    StockLotModel.expiry_date.is_(None),
                )
                .first()
            )
            if not lot:
                lot = StockLotModel(
                    product_id=product.id,
                    batch=BULK_OPENING_BATCH,
                    expiry_date=None,
                )
                db.add(lot)
                db.flush()

            check_controller_adjust_reason(user, "inventory_overage")

            movement = StockMovementModel(
                product_id=product.id,
                lot_id=lot.id,
                location_id=payload.location_id,
                qty_change=Decimal(qty),
                movement_type="adjust",
                source_document_type=None,
                source_document_id=None,
                created_by_user_id=user.id,
                reason_code="inventory_overage",
            )
            db.add(movement)
            log_action(
                db,
                user_id=user.id,
                action=ACTION_CREATE,
                entity_type="stock_movement",
                entity_id=str(movement.id),
                new_data={
                    "product_id": str(product.id),
                    "lot_id": str(lot.id),
                    "location_id": str(payload.location_id),
                    "qty_change": str(qty),
                    "movement_type": "adjust",
                    "reason_code": "inventory_overage",
                    "import_code": code,
                },
                ip_address=get_client_ip(request),
            )
            db.commit()
            applied_rows += 1
        except HTTPException:
            db.rollback()
            raise
        except Exception as e:
            db.rollback()
            skipped_rows += 1
            errors.append(ImportQtyErrorItem(code=code, message=str(e)))
            if len(errors) >= _MAX_IMPORT_QTY_ERRORS:
                break

    return ImportQtyResponse(applied_rows=applied_rows, skipped_rows=skipped_rows, errors=errors)


def _http_exception_detail_message(exc: HTTPException) -> str:
    d = exc.detail
    if isinstance(d, str):
        return d
    return str(d)


@router.post(
    "/import-qty-rows",
    response_model=ImportQtyResponse,
    status_code=status.HTTP_200_OK,
    summary="Import stock per row with location code and optional expiry (adjust + overage)",
)
@router.post(
    "/import-qty-rows/",
    response_model=ImportQtyResponse,
    status_code=status.HTTP_200_OK,
    summary="Import stock per row with location code and optional expiry (adjust + overage)",
)
async def import_inventory_qty_rows(
    request: Request,
    payload: ImportQtyRowsRequest,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_permission("inventory:adjust")),
):
    """
    Har bir qatorda: mahsulot (SKU yoki shtrix), joy kodi, miqdor, ixtiyoriy muddat.
    (code, location_code, expiry_date, brand_id) bo‘yicha miqdorlar yig‘iladi.
    """
    applied_rows = 0
    skipped_rows = 0
    errors: List[ImportQtyErrorItem] = []

    merged: dict[tuple[str, str, Optional[date], Optional[UUID]], int] = defaultdict(int)
    for line in payload.lines:
        c = line.code.strip()
        lc = line.location_code.strip()
        if not c or not lc:
            continue
        resolved_brand_id, brand_resolve_err = _resolve_import_brand_ref(db, line.brand_id)
        if brand_resolve_err:
            skipped_rows += 1
            errors.append(ImportQtyErrorItem(code=f"{c} @ {lc}", message=brand_resolve_err))
            if len(errors) >= _MAX_IMPORT_QTY_ERRORS:
                break
            continue
        merged[(c, lc, line.expiry_date, resolved_brand_id)] += line.qty

    if not merged:
        if errors:
            return ImportQtyResponse(applied_rows=0, skipped_rows=skipped_rows, errors=errors)
        raise HTTPException(status_code=400, detail="No valid lines after merging")

    for (code, loc_code, exp_d, file_brand_id), qty in merged.items():
        if len(errors) >= _MAX_IMPORT_QTY_ERRORS:
            break
        err_label = f"{code} @ {loc_code}"
        try:
            loc = _resolve_location_by_code(db, loc_code)
            if not loc:
                skipped_rows += 1
                errors.append(ImportQtyErrorItem(code=err_label, message="Location not found"))
                continue
            if loc.type == "warehouse":
                skipped_rows += 1
                errors.append(ImportQtyErrorItem(code=err_label, message="Cannot import to warehouse root"))
                continue
            if not _location_valid_for_warehouse(db, loc, payload.warehouse):
                skipped_rows += 1
                errors.append(
                    ImportQtyErrorItem(
                        code=err_label,
                        message="Location inactive or does not match selected warehouse",
                    )
                )
                continue

            product = _resolve_product_by_sku_or_barcode(db, code)
            if not product:
                skipped_rows += 1
                errors.append(ImportQtyErrorItem(code=err_label, message="Product not found"))
                continue
            if file_brand_id:
                if product.brand_id is None:
                    brand = (
                        db.query(BrandModel)
                        .filter(BrandModel.id == file_brand_id, BrandModel.is_active.is_(True))
                        .one_or_none()
                    )
                    if not brand:
                        skipped_rows += 1
                        errors.append(ImportQtyErrorItem(code=err_label, message="brand_id not found or inactive"))
                        continue
                    product.brand_id = brand.id
                    product.brand_code = (brand.code or "").strip() or None
                    product.brand = (brand.display_name or brand.name or "").strip() or None
                elif product.brand_id != file_brand_id:
                    skipped_rows += 1
                    errors.append(ImportQtyErrorItem(code=err_label, message="brand_id mismatch"))
                    continue

            check_location_single_expiry(db, loc.id, product.id, exp_d)

            lot = _ensure_lot_for_import(db, product.id, exp_d)

            check_controller_adjust_reason(user, "inventory_overage")

            movement = StockMovementModel(
                product_id=product.id,
                lot_id=lot.id,
                location_id=loc.id,
                qty_change=Decimal(qty),
                movement_type="adjust",
                source_document_type=None,
                source_document_id=None,
                created_by_user_id=user.id,
                reason_code="inventory_overage",
            )
            db.add(movement)
            log_action(
                db,
                user_id=user.id,
                action=ACTION_CREATE,
                entity_type="stock_movement",
                entity_id=str(movement.id),
                new_data={
                    "product_id": str(product.id),
                    "lot_id": str(lot.id),
                    "location_id": str(loc.id),
                    "qty_change": str(qty),
                    "movement_type": "adjust",
                    "reason_code": "inventory_overage",
                    "import_code": code,
                    "import_location_code": loc_code,
                    "import_expiry": str(exp_d) if exp_d else None,
                    "import_brand_id": str(file_brand_id) if file_brand_id else None,
                },
                ip_address=get_client_ip(request),
            )
            db.commit()
            applied_rows += 1
        except HTTPException as he:
            db.rollback()
            skipped_rows += 1
            errors.append(ImportQtyErrorItem(code=err_label, message=_http_exception_detail_message(he)))
            if len(errors) >= _MAX_IMPORT_QTY_ERRORS:
                break
        except Exception as e:
            db.rollback()
            skipped_rows += 1
            errors.append(ImportQtyErrorItem(code=err_label, message=str(e)))
            if len(errors) >= _MAX_IMPORT_QTY_ERRORS:
                break

    return ImportQtyResponse(applied_rows=applied_rows, skipped_rows=skipped_rows, errors=errors)


@router.get("/movements", response_model=List[StockMovementOut], summary="List stock movements")
@router.get("/movements/", response_model=List[StockMovementOut], summary="List stock movements")
async def list_stock_movements(
    product_id: Optional[UUID] = None,
    lot_id: Optional[UUID] = None,
    location_id: Optional[UUID] = None,
    movement_type: Optional[str] = None,
    reason_code: Optional[str] = None,
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
    if reason_code:
        tokens = [token.strip() for token in reason_code.split(",") if token.strip()]
        query = query.filter(StockMovementModel.reason_code.in_(tokens))
    if date_from:
        query = query.filter(func.date(StockMovementModel.created_at) >= date_from)
    if date_to:
        query = query.filter(func.date(StockMovementModel.created_at) <= date_to)
    if source_document_type:
        query = query.filter(StockMovementModel.source_document_type == source_document_type)
    if source_document_id:
        query = query.filter(StockMovementModel.source_document_id == source_document_id)

    movements = (
        query.options(
            selectinload(StockMovementModel.product),
            selectinload(StockMovementModel.lot),
            selectinload(StockMovementModel.location),
        )
        .order_by(StockMovementModel.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    creator_ids = {m.created_by_user_id for m in movements if m.created_by_user_id}
    creator_map = {}
    if creator_ids:
        for u in db.query(UserModel).filter(UserModel.id.in_(creator_ids)).all():
            # Ism-familiya yoki username; UUID hech qachon ko'rsatilmasin
            creator_map[u.id] = (
                (u.full_name and u.full_name.strip()) or
                (u.username and u.username.strip()) or
                (u.code and f"#{u.code}".strip()) or
                "—"
            )
    return [
        _to_movement(mov, creator_map.get(mov.created_by_user_id))
        for mov in movements
    ]


@router.get(
    "/reserve-history",
    response_model=ReserveHistoryResponse,
    summary="List reserve history (allocate/unallocate)",
)
@router.get(
    "/reserve-history/",
    response_model=ReserveHistoryResponse,
    summary="List reserve history (allocate/unallocate)",
)
async def list_reserve_history(
    search: Optional[str] = None,
    movement_type: Optional[str] = Query(
        default=None, description="allocate,unallocate (default: both)"
    ),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    warehouse: Optional[Literal["main", "showroom"]] = Query(default="main"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    movement_tokens = [token.strip() for token in (movement_type or "").split(",") if token.strip()]
    if movement_tokens:
        invalid = [token for token in movement_tokens if token not in {"allocate", "unallocate"}]
        if invalid:
            raise HTTPException(status_code=400, detail="Invalid movement_type for reserve history")
    else:
        movement_tokens = ["allocate", "unallocate"]

    doc_alias = aliased(DocumentModel)
    order_direct_alias = aliased(OrderModel)
    order_from_doc_alias = aliased(OrderModel)

    query = (
        db.query(StockMovementModel)
        .join(ProductModel, ProductModel.id == StockMovementModel.product_id)
        .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
        .outerjoin(
            doc_alias,
            and_(
                StockMovementModel.source_document_type == "document",
                StockMovementModel.source_document_id == doc_alias.id,
            ),
        )
        .outerjoin(
            order_direct_alias,
            and_(
                StockMovementModel.source_document_type == "order",
                StockMovementModel.source_document_id == order_direct_alias.id,
            ),
        )
        .outerjoin(order_from_doc_alias, order_from_doc_alias.id == doc_alias.order_id)
        .filter(StockMovementModel.movement_type.in_(movement_tokens))
    )

    location_ids = _location_ids_for_warehouse(db, warehouse)
    if location_ids is not None:
        if len(location_ids) == 0:
            return ReserveHistoryResponse(items=[], total=0, limit=limit, offset=offset)
        query = query.filter(StockMovementModel.location_id.in_(location_ids))

    if date_from:
        query = query.filter(func.date(StockMovementModel.created_at) >= date_from)
    if date_to:
        query = query.filter(func.date(StockMovementModel.created_at) <= date_to)

    term = (search or "").strip()
    if term:
        term_like = f"%{term}%"
        query = query.filter(
            or_(
                func.lower(ProductModel.sku).ilike(func.lower(term_like)),
                func.lower(ProductModel.name).ilike(func.lower(term_like)),
                func.lower(LocationModel.code).ilike(func.lower(term_like)),
                func.lower(func.coalesce(doc_alias.doc_no, "")).ilike(func.lower(term_like)),
                func.lower(func.coalesce(order_direct_alias.order_number, "")).ilike(func.lower(term_like)),
                func.lower(func.coalesce(order_from_doc_alias.order_number, "")).ilike(func.lower(term_like)),
            )
        )

    total = query.with_entities(func.count(StockMovementModel.id)).scalar() or 0
    movements = (
        query.options(
            selectinload(StockMovementModel.product),
            selectinload(StockMovementModel.lot),
            selectinload(StockMovementModel.location),
        )
        .order_by(StockMovementModel.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    creator_ids = {m.created_by_user_id for m in movements if m.created_by_user_id}
    creator_map: dict[UUID, str] = {}
    if creator_ids:
        for user_row in db.query(UserModel).filter(UserModel.id.in_(creator_ids)).all():
            creator_map[user_row.id] = (
                (user_row.full_name and user_row.full_name.strip())
                or (user_row.username and user_row.username.strip())
                or (user_row.code and f"#{user_row.code}".strip())
                or "—"
            )

    doc_ids = [
        m.source_document_id
        for m in movements
        if m.source_document_type == "document" and m.source_document_id is not None
    ]
    docs_by_id: dict[UUID, DocumentModel] = {}
    if doc_ids:
        for doc in db.query(DocumentModel).filter(DocumentModel.id.in_(doc_ids)).all():
            docs_by_id[doc.id] = doc

    order_ids: set[UUID] = set()
    for movement in movements:
        if movement.source_document_type == "order" and movement.source_document_id:
            order_ids.add(movement.source_document_id)
        elif movement.source_document_type == "document" and movement.source_document_id:
            doc = docs_by_id.get(movement.source_document_id)
            if doc and doc.order_id:
                order_ids.add(doc.order_id)

    orders_by_id: dict[UUID, OrderModel] = {}
    if order_ids:
        for order in db.query(OrderModel).filter(OrderModel.id.in_(order_ids)).all():
            orders_by_id[order.id] = order

    items: list[ReserveHistoryRow] = []
    for movement in movements:
        doc_no: Optional[str] = None
        order_id: Optional[UUID] = None
        order_number: Optional[str] = None
        if movement.source_document_type == "document" and movement.source_document_id:
            doc = docs_by_id.get(movement.source_document_id)
            if doc:
                doc_no = doc.doc_no
                order_id = doc.order_id
        elif movement.source_document_type == "order" and movement.source_document_id:
            order_id = movement.source_document_id

        if order_id:
            order = orders_by_id.get(order_id)
            if order:
                order_number = order.order_number

        items.append(
            _to_reserve_history_row(
                movement,
                created_by_username=creator_map.get(movement.created_by_user_id),
                order_id=order_id,
                order_number=order_number,
                doc_no=doc_no,
            )
        )

    return ReserveHistoryResponse(items=items, total=int(total), limit=limit, offset=offset)


@router.get(
    "/reserve-by-order",
    response_model=ReserveByOrderResponse,
    summary="Reserve breakdown by order (net allocate/unallocate per product+order)",
)
@router.get(
    "/reserve-by-order/",
    response_model=ReserveByOrderResponse,
    summary="Reserve breakdown by order (net allocate/unallocate per product+order)",
)
async def list_reserve_by_order(
    warehouse: Optional[Literal["main", "showroom"]] = Query(default="main"),
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    """
    Har (mahsulot, buyurtma) juftligi uchun omborda net rezerv > 0 bo'lgan qatorlar.
    So'nggi harakat va undagi foydalanuvchi max(created_at) bo'yicha rn=1 qatoridan olinadi.
    """
    location_ids = _location_ids_for_warehouse(db, warehouse)
    if location_ids is not None and len(location_ids) == 0:
        return ReserveByOrderResponse(items=[])

    doc_reserve = aliased(DocumentModel)
    order_id_resolved = case(
        (
            and_(
                StockMovementModel.source_document_type == "order",
                StockMovementModel.source_document_id.isnot(None),
            ),
            StockMovementModel.source_document_id,
        ),
        (
            and_(
                StockMovementModel.source_document_type == "document",
                doc_reserve.order_id.isnot(None),
            ),
            doc_reserve.order_id,
        ),
        else_=None,
    ).label("order_id")

    base_q = (
        db.query(
            StockMovementModel.product_id,
            order_id_resolved,
            StockMovementModel.qty_change,
            StockMovementModel.created_at,
            StockMovementModel.created_by_user_id,
        )
        .outerjoin(
            doc_reserve,
            and_(
                StockMovementModel.source_document_type == "document",
                StockMovementModel.source_document_id == doc_reserve.id,
            ),
        )
        .filter(StockMovementModel.movement_type.in_(("allocate", "unallocate")))
        .filter(order_id_resolved.isnot(None))
    )
    if location_ids is not None:
        base_q = base_q.filter(StockMovementModel.location_id.in_(location_ids))

    m_sub = base_q.subquery("m")

    rn = func.row_number().over(
        partition_by=(m_sub.c.product_id, m_sub.c.order_id),
        order_by=m_sub.c.created_at.desc(),
    ).label("rn")

    latest_ranked = db.query(
        m_sub.c.product_id,
        m_sub.c.order_id,
        m_sub.c.created_at,
        m_sub.c.created_by_user_id,
        rn,
    ).select_from(m_sub).subquery("lr")

    latest_per_po = (
        db.query(
            latest_ranked.c.product_id,
            latest_ranked.c.order_id,
            latest_ranked.c.created_at,
            latest_ranked.c.created_by_user_id,
        )
        .filter(latest_ranked.c.rn == 1)
        .subquery("latest")
    )

    agg = (
        db.query(
            m_sub.c.product_id,
            m_sub.c.order_id,
            func.sum(m_sub.c.qty_change).label("reserved_qty"),
            func.max(m_sub.c.created_at).label("last_movement_at"),
        )
        .group_by(m_sub.c.product_id, m_sub.c.order_id)
        .having(func.sum(m_sub.c.qty_change) > 0)
        .subquery("agg")
    )

    q = (
        db.query(
            agg.c.product_id,
            agg.c.order_id,
            agg.c.reserved_qty,
            agg.c.last_movement_at,
            latest_per_po.c.created_by_user_id.label("last_movement_by_user_id"),
            ProductModel.sku.label("product_code"),
            ProductModel.name.label("product_name"),
            OrderModel.order_number,
        )
        .join(
            latest_per_po,
            and_(
                latest_per_po.c.product_id == agg.c.product_id,
                latest_per_po.c.order_id == agg.c.order_id,
            ),
        )
        .join(ProductModel, ProductModel.id == agg.c.product_id)
        .join(OrderModel, OrderModel.id == agg.c.order_id)
        .order_by(ProductModel.sku.asc(), OrderModel.order_number.asc().nullslast())
    )

    term = (search or "").strip()
    if term:
        term_like = f"%{term}%"
        q = q.filter(
            or_(
                func.lower(ProductModel.sku).ilike(func.lower(term_like)),
                func.lower(ProductModel.name).ilike(func.lower(term_like)),
                func.lower(func.coalesce(OrderModel.order_number, "")).ilike(func.lower(term_like)),
            )
        )

    raw_rows = q.all()

    product_has_reserve = _product_ids_with_positive_net_reserved(db, location_ids)

    user_ids = {r.last_movement_by_user_id for r in raw_rows if r.last_movement_by_user_id}
    creator_map: dict[UUID, str] = {}
    if user_ids:
        for user_row in db.query(UserModel).filter(UserModel.id.in_(user_ids)).all():
            creator_map[user_row.id] = (
                (user_row.full_name and user_row.full_name.strip())
                or (user_row.username and user_row.username.strip())
                or (user_row.code and f"#{user_row.code}".strip())
                or "—"
            )

    items: list[ReserveByOrderRow] = []
    for r in raw_rows:
        if r.product_id not in product_has_reserve:
            continue
        uid = r.last_movement_by_user_id
        items.append(
            ReserveByOrderRow(
                product_id=r.product_id,
                product_code=r.product_code or "",
                product_name=r.product_name or "",
                order_id=r.order_id,
                order_number=r.order_number,
                reserved_qty=r.reserved_qty,
                last_movement_at=r.last_movement_at,
                last_movement_by_user_id=uid,
                last_movement_by_username=creator_map.get(uid) if uid else None,
            )
        )

    return ReserveByOrderResponse(items=items)


@router.get(
    "/reserve-stuck-summary",
    response_model=ReserveStuckSummaryResponse,
    summary="Summary for reserves stuck longer than given hours",
)
@router.get(
    "/reserve-stuck-summary/",
    response_model=ReserveStuckSummaryResponse,
    summary="Summary for reserves stuck longer than given hours",
)
async def reserve_stuck_summary(
    warehouse: Literal["main", "showroom"] = Query(default="main"),
    age_hours: int = Query(default=48, ge=1, le=24 * 60),
    sample_limit: int = Query(default=5, ge=1, le=20),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    location_ids = _location_ids_for_warehouse(db, warehouse)
    if location_ids is not None and len(location_ids) == 0:
        return ReserveStuckSummaryResponse(
            warehouse=warehouse,
            age_hours=age_hours,
            stuck_orders_count=0,
            stuck_products_count=0,
            stuck_rows_count=0,
            oldest_hours=0,
            sample=[],
        )

    now_utc = datetime.now(timezone.utc)

    doc_reserve = aliased(DocumentModel)
    order_id_resolved = case(
        (
            and_(
                StockMovementModel.source_document_type == "order",
                StockMovementModel.source_document_id.isnot(None),
            ),
            StockMovementModel.source_document_id,
        ),
        (
            and_(
                StockMovementModel.source_document_type == "document",
                doc_reserve.order_id.isnot(None),
            ),
            doc_reserve.order_id,
        ),
        else_=None,
    ).label("order_id")

    base_q = (
        db.query(
            StockMovementModel.product_id,
            order_id_resolved,
            StockMovementModel.qty_change,
            StockMovementModel.created_at,
            StockMovementModel.created_by_user_id,
        )
        .outerjoin(
            doc_reserve,
            and_(
                StockMovementModel.source_document_type == "document",
                StockMovementModel.source_document_id == doc_reserve.id,
            ),
        )
        .filter(StockMovementModel.movement_type.in_(("allocate", "unallocate")))
        .filter(order_id_resolved.isnot(None))
    )
    if location_ids is not None:
        base_q = base_q.filter(StockMovementModel.location_id.in_(location_ids))

    m_sub = base_q.subquery("m")

    rn = func.row_number().over(
        partition_by=(m_sub.c.product_id, m_sub.c.order_id),
        order_by=m_sub.c.created_at.desc(),
    ).label("rn")

    latest_ranked = db.query(
        m_sub.c.product_id,
        m_sub.c.order_id,
        m_sub.c.created_at,
        m_sub.c.created_by_user_id,
        rn,
    ).select_from(m_sub).subquery("lr")

    latest_per_po = (
        db.query(
            latest_ranked.c.product_id,
            latest_ranked.c.order_id,
            latest_ranked.c.created_at,
            latest_ranked.c.created_by_user_id,
        )
        .filter(latest_ranked.c.rn == 1)
        .subquery("latest")
    )

    agg = (
        db.query(
            m_sub.c.product_id,
            m_sub.c.order_id,
            func.sum(m_sub.c.qty_change).label("reserved_qty"),
            func.max(m_sub.c.created_at).label("last_movement_at"),
        )
        .group_by(m_sub.c.product_id, m_sub.c.order_id)
        .having(func.sum(m_sub.c.qty_change) > 0)
        .subquery("agg")
    )

    raw_rows = (
        db.query(
            agg.c.product_id,
            agg.c.order_id,
            agg.c.reserved_qty,
            agg.c.last_movement_at,
            latest_per_po.c.created_by_user_id.label("last_movement_by_user_id"),
            ProductModel.sku.label("product_code"),
            ProductModel.name.label("product_name"),
            OrderModel.order_number,
        )
        .join(
            latest_per_po,
            and_(
                latest_per_po.c.product_id == agg.c.product_id,
                latest_per_po.c.order_id == agg.c.order_id,
            ),
        )
        .join(ProductModel, ProductModel.id == agg.c.product_id)
        .join(OrderModel, OrderModel.id == agg.c.order_id)
        .all()
    )

    product_has_reserve = _product_ids_with_positive_net_reserved(db, location_ids)
    raw_rows = [r for r in raw_rows if r.product_id in product_has_reserve]

    user_ids = {r.last_movement_by_user_id for r in raw_rows if r.last_movement_by_user_id}
    creator_map: dict[UUID, str] = {}
    if user_ids:
        for user_row in db.query(UserModel).filter(UserModel.id.in_(user_ids)).all():
            creator_map[user_row.id] = (
                (user_row.full_name and user_row.full_name.strip())
                or (user_row.username and user_row.username.strip())
                or (user_row.code and f"#{user_row.code}".strip())
                or "—"
            )

    stuck_rows: list[ReserveStuckSampleRow] = []
    unique_orders: set[UUID] = set()
    unique_products: set[UUID] = set()
    oldest_hours = 0

    for r in raw_rows:
        last_at = r.last_movement_at
        if last_at is None:
            continue
        if last_at.tzinfo is None:
            last_at = last_at.replace(tzinfo=timezone.utc)
        else:
            last_at = last_at.astimezone(timezone.utc)
        age = now_utc - last_at
        age_h = int(age.total_seconds() // 3600)
        if age_h < age_hours:
            continue
        unique_orders.add(r.order_id)
        unique_products.add(r.product_id)
        if age_h > oldest_hours:
            oldest_hours = age_h
        stuck_rows.append(
            ReserveStuckSampleRow(
                product_id=r.product_id,
                product_code=r.product_code or "",
                product_name=r.product_name or "",
                order_id=r.order_id,
                order_number=r.order_number,
                reserved_qty=r.reserved_qty,
                last_movement_at=r.last_movement_at,
                age_hours=age_h,
                last_movement_by_user_id=r.last_movement_by_user_id,
                last_movement_by_username=creator_map.get(r.last_movement_by_user_id)
                if r.last_movement_by_user_id
                else None,
            )
        )

    stuck_rows.sort(key=lambda x: x.age_hours, reverse=True)
    return ReserveStuckSummaryResponse(
        warehouse=warehouse,
        age_hours=age_hours,
        stuck_orders_count=len(unique_orders),
        stuck_products_count=len(unique_products),
        stuck_rows_count=len(stuck_rows),
        oldest_hours=oldest_hours,
        sample=stuck_rows[:sample_limit],
    )


@router.post("/movements", response_model=StockMovementOut, status_code=status.HTTP_201_CREATED)
@router.post("/movements/", response_model=StockMovementOut, status_code=status.HTTP_201_CREATED)
async def create_stock_movement(
    request: Request,
    payload: StockMovementCreate,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_permission("inventory:adjust")),
):
    def _run_create():
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

        if payload.qty_change > 0:
            check_location_single_expiry(db, payload.location_id, payload.product_id, lot.expiry_date)

        if payload.movement_type == "adjust":
            check_controller_adjust_reason(user, payload.reason_code)

        qty_abs = abs(Decimal(str(payload.qty_change)))
        if payload.movement_type == "allocate" and payload.qty_change > 0:
            require_sufficient_available(
                db,
                payload.product_id,
                payload.lot_id,
                payload.location_id,
                qty_abs,
                lock=True,
            )
        elif payload.movement_type == "unallocate" and payload.qty_change < 0:
            require_sufficient_reserved(
                db,
                payload.product_id,
                payload.lot_id,
                payload.location_id,
                qty_abs,
                lock=True,
            )
        elif payload.qty_change < 0 and payload.movement_type not in ("allocate", "unallocate"):
            require_sufficient_available(
                db,
                payload.product_id,
                payload.lot_id,
                payload.location_id,
                qty_abs,
                lock=True,
            )

        movement = StockMovementModel(
            product_id=payload.product_id,
            lot_id=payload.lot_id,
            location_id=payload.location_id,
            qty_change=payload.qty_change,
            movement_type=payload.movement_type,
            source_document_type=payload.source_document_type,
            source_document_id=payload.source_document_id,
            created_by_user_id=user.id,
            reason_code=payload.reason_code,
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
        display_name = (
            (user.full_name and user.full_name.strip())
            or (user.username and user.username.strip())
            or (user.code and f"#{user.code}")
            or "—"
        )
        return _to_movement(movement, created_by_username=display_name)

    return _run_with_idempotency(
        db=db,
        user_id=user.id,
        key=idempotency_key,
        scope="inventory_movements_create",
        payload=payload.model_dump(mode="json"),
        expected_status=status.HTTP_201_CREATED,
        run=_run_create,
    )


@router.post(
    "/movements/transfer-location",
    response_model=LocationTransferOut,
    status_code=status.HTTP_200_OK,
    summary="Move all available stock from one location to another (atomic)",
)
@router.post(
    "/movements/transfer-location/",
    response_model=LocationTransferOut,
    status_code=status.HTTP_200_OK,
    summary="Move all available stock from one location to another (atomic)",
)
async def transfer_location_stock(
    request: Request,
    payload: LocationTransferIn,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_permission("inventory:adjust")),
):
    def _run_transfer():
        if payload.from_location_id == payload.to_location_id:
            raise HTTPException(status_code=400, detail="Source and destination locations must differ")

        from_loc = (
            db.query(LocationModel)
            .filter(LocationModel.id == payload.from_location_id, LocationModel.is_active == True)
            .one_or_none()
        )
        to_loc = (
            db.query(LocationModel)
            .filter(LocationModel.id == payload.to_location_id, LocationModel.is_active == True)
            .one_or_none()
        )
        if not from_loc:
            raise HTTPException(status_code=400, detail="Source location not found or inactive")
        if not to_loc:
            raise HTTPException(status_code=400, detail="Destination location not found or inactive")

        check_controller_adjust_reason(user, "inventory_shortage")
        check_controller_adjust_reason(user, "inventory_overage")

        raw_rows = _get_lot_level_balances(db, product_ids=None, location_id=payload.from_location_id)
        rows = [r for r in raw_rows if Decimal(str(r["available"])) > 0]
        if not rows:
            raise HTTPException(
                status_code=400,
                detail="No available quantity to transfer at the source location",
            )
        rows_by_lot = {r["lot_id"]: r for r in rows}

        lines_requested = 0
        transfer_rows: list[dict[str, Any]] = []
        if payload.mode == "partial":
            if not payload.lines:
                raise HTTPException(status_code=400, detail="Transfer lines are required for partial mode")
            lines_requested = len(payload.lines)
            for line in payload.lines:
                r = rows_by_lot.get(line.lot_id)
                if r is None:
                    raise HTTPException(status_code=400, detail=f"Lot not available at source location: {line.lot_id}")
                if r["product_id"] != line.product_id:
                    raise HTTPException(status_code=400, detail=f"Product/lot mismatch: {line.lot_id}")
                available_qty = Decimal(str(r["available"]))
                if line.qty > available_qty:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Requested qty exceeds available for lot {line.lot_id}",
                    )
                transfer_rows.append(
                    {
                        "product_id": r["product_id"],
                        "lot_id": r["lot_id"],
                        "qty": line.qty,
                    }
                )
        else:
            transfer_rows = [
                {
                    "product_id": r["product_id"],
                    "lot_id": r["lot_id"],
                    "qty": Decimal(str(r["available"])),
                }
                for r in rows
            ]

        if not transfer_rows:
            raise HTTPException(status_code=400, detail="No transfer lines selected")

        client_ip = get_client_ip(request)
        movements_created = 0
        try:
            for r in transfer_rows:
                qty = Decimal(str(r["qty"]))
                if qty <= 0:
                    continue
                product_id = r["product_id"]
                lot_id = r["lot_id"]
                lot = db.query(StockLotModel).filter(StockLotModel.id == lot_id).one_or_none()
                if not lot or lot.product_id != product_id:
                    raise HTTPException(status_code=400, detail="Stock lot not found or mismatch")

                check_location_single_expiry(db, payload.to_location_id, product_id, lot.expiry_date)
                require_sufficient_available(
                    db,
                    product_id,
                    lot_id,
                    payload.from_location_id,
                    qty,
                    lock=True,
                )

                mov_out = StockMovementModel(
                    product_id=product_id,
                    lot_id=lot_id,
                    location_id=payload.from_location_id,
                    qty_change=-qty,
                    movement_type="adjust",
                    created_by_user_id=user.id,
                    reason_code="inventory_shortage",
                )
                mov_in = StockMovementModel(
                    product_id=product_id,
                    lot_id=lot_id,
                    location_id=payload.to_location_id,
                    qty_change=qty,
                    movement_type="adjust",
                    created_by_user_id=user.id,
                    reason_code="inventory_overage",
                )
                db.add(mov_out)
                db.add(mov_in)
                db.flush()

                log_action(
                    db,
                    user_id=user.id,
                    action=ACTION_CREATE,
                    entity_type="stock_movement",
                    entity_id=str(mov_out.id),
                    new_data={
                        "product_id": str(product_id),
                        "lot_id": str(lot_id),
                        "location_id": str(payload.from_location_id),
                        "qty_change": str(-qty),
                        "movement_type": "adjust",
                        "transfer_location_bulk": payload.mode == "full",
                        "transfer_location_partial": payload.mode == "partial",
                    },
                    ip_address=client_ip,
                )
                log_action(
                    db,
                    user_id=user.id,
                    action=ACTION_CREATE,
                    entity_type="stock_movement",
                    entity_id=str(mov_in.id),
                    new_data={
                        "product_id": str(product_id),
                        "lot_id": str(lot_id),
                        "location_id": str(payload.to_location_id),
                        "qty_change": str(qty),
                        "movement_type": "adjust",
                        "transfer_location_bulk": payload.mode == "full",
                        "transfer_location_partial": payload.mode == "partial",
                    },
                    ip_address=client_ip,
                )
                movements_created += 2

            _verify_non_negative_balances_or_raise(
                db,
                [
                    (r["lot_id"], payload.from_location_id) for r in transfer_rows
                ] + [
                    (r["lot_id"], payload.to_location_id) for r in transfer_rows
                ],
            )
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            raise

        return LocationTransferOut(
            lines_transferred=len(transfer_rows),
            movements_created=movements_created,
            lines_requested=lines_requested,
        )

    return _run_with_idempotency(
        db=db,
        user_id=user.id,
        key=idempotency_key,
        scope="inventory_transfer_location",
        payload=payload.model_dump(mode="json"),
        expected_status=status.HTTP_200_OK,
        run=_run_transfer,
    )


@router.post(
    "/brands/{brand_id}/zero-stock",
    response_model=BrandZeroStockResponse,
    status_code=status.HTTP_200_OK,
    summary="Zero all available stock for a brand across all locations",
)
@router.post(
    "/brands/{brand_id}/zero-stock/",
    response_model=BrandZeroStockResponse,
    status_code=status.HTTP_200_OK,
    summary="Zero all available stock for a brand across all locations",
)
async def zero_brand_stock(
    brand_id: UUID,
    request: Request,
    mode: Literal["brand_only", "reserve_only", "brand_and_reserve"] = Query(
        "brand_only",
        description="brand_only=adjust available stock, reserve_only=clear reserve, brand_and_reserve=both",
    ),
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_permission("inventory:adjust")),
):
    def _run_zero() -> BrandZeroStockResponse:
        brand_exists = db.query(exists().where(ProductModel.brand_id == brand_id)).scalar()
        if not brand_exists:
            raise HTTPException(status_code=404, detail="Brand not found or has no products")

        check_controller_adjust_reason(user, "inventory_shortage")
        check_controller_adjust_reason(user, "inventory_overage")

        on_hand_expr = func.sum(
            case(
                (
                    StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
                    StockMovementModel.qty_change,
                ),
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
                StockLotModel.product_id.label("product_id"),
                StockLotModel.id.label("lot_id"),
                StockMovementModel.location_id.label("location_id"),
                on_hand_expr.label("on_hand_qty"),
                reserved_expr.label("reserved_qty"),
                available_expr.label("available_qty"),
            )
            .join(ProductModel, ProductModel.id == StockLotModel.product_id)
            .join(StockMovementModel, StockMovementModel.lot_id == StockLotModel.id)
            .filter(ProductModel.brand_id == brand_id)
            .group_by(
                StockLotModel.product_id,
                StockLotModel.id,
                StockMovementModel.location_id,
            )
            .having((on_hand_expr != 0) | (reserved_expr != 0))
            .all()
        )

        if not rows:
            return BrandZeroStockResponse(
                brand_id=brand_id,
                products_affected=0,
                lots_affected=0,
                stock_movements_created=0,
                reserve_movements_created=0,
                reserve_lots_affected=0,
                movements_created=0,
                skipped=0,
            )

        client_ip = get_client_ip(request)
        product_ids: set[UUID] = set()
        lot_ids: set[UUID] = set()
        reserve_lot_ids: set[UUID] = set()
        stock_movements_created = 0
        reserve_movements_created = 0
        skipped = 0
        touched_rows: list[tuple[UUID, UUID]] = []
        try:
            for row in rows:
                lock_lot_location(db, row.lot_id, row.location_id)
                on_hand_qty, reserved_qty, available_qty = compute_lot_location_balances(
                    db,
                    row.lot_id,
                    row.location_id,
                )
                do_stock = mode in {"brand_only", "brand_and_reserve"} and available_qty != 0
                do_reserve = mode in {"reserve_only", "brand_and_reserve"} and reserved_qty != 0
                if not do_stock and not do_reserve:
                    skipped += 1
                    continue
                product_ids.add(row.product_id)
                lot_ids.add(row.lot_id)
                touched_rows.append((row.lot_id, row.location_id))
                if do_stock:
                    stock_delta = -available_qty
                    reason_code = "inventory_shortage" if stock_delta < 0 else "inventory_overage"
                    movement = StockMovementModel(
                        product_id=row.product_id,
                        lot_id=row.lot_id,
                        location_id=row.location_id,
                        qty_change=stock_delta,
                        movement_type="adjust",
                        created_by_user_id=user.id,
                        reason_code=reason_code,
                    )
                    db.add(movement)
                    db.flush()
                    log_action(
                        db,
                        user_id=user.id,
                        action=ACTION_CREATE,
                        entity_type="stock_movement",
                        entity_id=str(movement.id),
                        new_data={
                            "product_id": str(row.product_id),
                            "lot_id": str(row.lot_id),
                            "location_id": str(row.location_id),
                            "qty_change": str(stock_delta),
                            "movement_type": "adjust",
                            "reason_code": reason_code,
                            "bulk_brand_zero": True,
                            "brand_id": str(brand_id),
                            "mode": mode,
                        },
                        ip_address=client_ip,
                    )
                    stock_movements_created += 1
                if do_reserve:
                    reserve_lot_ids.add(row.lot_id)
                    movement = StockMovementModel(
                        product_id=row.product_id,
                        lot_id=row.lot_id,
                        location_id=row.location_id,
                        qty_change=-reserved_qty,
                        movement_type="unallocate",
                        created_by_user_id=user.id,
                    )
                    db.add(movement)
                    db.flush()
                    log_action(
                        db,
                        user_id=user.id,
                        action=ACTION_CREATE,
                        entity_type="stock_movement",
                        entity_id=str(movement.id),
                        new_data={
                            "product_id": str(row.product_id),
                            "lot_id": str(row.lot_id),
                            "location_id": str(row.location_id),
                            "qty_change": str(-reserved_qty),
                            "movement_type": "unallocate",
                            "bulk_brand_zero": True,
                            "bulk_brand_zero_reserved": True,
                            "brand_id": str(brand_id),
                            "mode": mode,
                        },
                        ip_address=client_ip,
                    )
                    reserve_movements_created += 1
            _verify_non_negative_balances_or_raise(db, touched_rows)
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            raise
        movements_created = stock_movements_created + reserve_movements_created
        return BrandZeroStockResponse(
            brand_id=brand_id,
            products_affected=len(product_ids),
            lots_affected=len(lot_ids),
            stock_movements_created=stock_movements_created,
            reserve_movements_created=reserve_movements_created,
            reserve_lots_affected=len(reserve_lot_ids),
            movements_created=movements_created,
            skipped=skipped,
        )

    return _run_with_idempotency(
        db=db,
        user_id=user.id,
        key=idempotency_key,
        scope="inventory_zero_brand_stock",
        payload={"brand_id": str(brand_id), "mode": mode},
        expected_status=status.HTTP_200_OK,
        run=_run_zero,
    )


@router.post(
    "/zero-stock/main",
    response_model=MainZeroStockResponse,
    status_code=status.HTTP_200_OK,
    summary="Zero all stock and reserve in main warehouse",
)
@router.post(
    "/zero-stock/main/",
    response_model=MainZeroStockResponse,
    status_code=status.HTTP_200_OK,
    summary="Zero all stock and reserve in main warehouse",
)
async def zero_main_stock(
    request: Request,
    mode: Literal["brand_only", "reserve_only", "brand_and_reserve"] = Query(
        "brand_and_reserve",
        description="brand_only=adjust on-hand, reserve_only=clear reserve, brand_and_reserve=both",
    ),
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_permission("inventory:adjust")),
):
    def _run_zero_main() -> MainZeroStockResponse:
        main_location_ids = _location_ids_for_warehouse(db, "main") or []
        if not main_location_ids:
            return MainZeroStockResponse(
                mode=mode,
                products_affected=0,
                lots_affected=0,
                stock_movements_created=0,
                reserve_movements_created=0,
                reserve_lots_affected=0,
                movements_created=0,
                skipped=0,
            )

        check_controller_adjust_reason(user, "inventory_shortage")
        check_controller_adjust_reason(user, "inventory_overage")

        on_hand_expr = func.sum(
            case(
                (
                    StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
                    StockMovementModel.qty_change,
                ),
                else_=0,
            )
        )
        reserved_expr = func.sum(
            case(
                (StockMovementModel.movement_type.in_(("allocate", "unallocate")), StockMovementModel.qty_change),
                else_=0,
            )
        )

        rows = (
            db.query(
                StockLotModel.product_id.label("product_id"),
                StockLotModel.id.label("lot_id"),
                StockMovementModel.location_id.label("location_id"),
                on_hand_expr.label("on_hand_qty"),
                reserved_expr.label("reserved_qty"),
            )
            .join(StockMovementModel, StockMovementModel.lot_id == StockLotModel.id)
            .filter(StockMovementModel.location_id.in_(main_location_ids))
            .group_by(
                StockLotModel.product_id,
                StockLotModel.id,
                StockMovementModel.location_id,
            )
            .having((on_hand_expr != 0) | (reserved_expr != 0))
            .all()
        )
        if not rows:
            return MainZeroStockResponse(
                mode=mode,
                products_affected=0,
                lots_affected=0,
                stock_movements_created=0,
                reserve_movements_created=0,
                reserve_lots_affected=0,
                movements_created=0,
                skipped=0,
            )

        client_ip = get_client_ip(request)
        product_ids: set[UUID] = set()
        lot_ids: set[UUID] = set()
        reserve_lot_ids: set[UUID] = set()
        stock_movements_created = 0
        reserve_movements_created = 0
        skipped = 0
        touched_rows: list[tuple[UUID, UUID]] = []
        try:
            for row in rows:
                lock_lot_location(db, row.lot_id, row.location_id)
                on_hand_qty, reserved_qty, _available_qty = compute_lot_location_balances(
                    db,
                    row.lot_id,
                    row.location_id,
                )
                do_stock = mode in {"brand_only", "brand_and_reserve"} and on_hand_qty != 0
                do_reserve = mode in {"reserve_only", "brand_and_reserve"} and reserved_qty != 0
                if not do_stock and not do_reserve:
                    skipped += 1
                    continue
                product_ids.add(row.product_id)
                lot_ids.add(row.lot_id)
                touched_rows.append((row.lot_id, row.location_id))
                if do_stock:
                    stock_delta = -on_hand_qty
                    reason_code = "inventory_shortage" if stock_delta < 0 else "inventory_overage"
                    stock_movement = StockMovementModel(
                        product_id=row.product_id,
                        lot_id=row.lot_id,
                        location_id=row.location_id,
                        qty_change=stock_delta,
                        movement_type="adjust",
                        created_by_user_id=user.id,
                        reason_code=reason_code,
                    )
                    db.add(stock_movement)
                    db.flush()
                    log_action(
                        db,
                        user_id=user.id,
                        action=ACTION_CREATE,
                        entity_type="stock_movement",
                        entity_id=str(stock_movement.id),
                        new_data={
                            "product_id": str(row.product_id),
                            "lot_id": str(row.lot_id),
                            "location_id": str(row.location_id),
                            "qty_change": str(stock_delta),
                            "movement_type": "adjust",
                            "reason_code": reason_code,
                            "bulk_main_zero": True,
                            "mode": mode,
                        },
                        ip_address=client_ip,
                    )
                    stock_movements_created += 1
                if do_reserve:
                    reserve_lot_ids.add(row.lot_id)
                    reserve_movement = StockMovementModel(
                        product_id=row.product_id,
                        lot_id=row.lot_id,
                        location_id=row.location_id,
                        qty_change=-reserved_qty,
                        movement_type="unallocate",
                        created_by_user_id=user.id,
                    )
                    db.add(reserve_movement)
                    db.flush()
                    log_action(
                        db,
                        user_id=user.id,
                        action=ACTION_CREATE,
                        entity_type="stock_movement",
                        entity_id=str(reserve_movement.id),
                        new_data={
                            "product_id": str(row.product_id),
                            "lot_id": str(row.lot_id),
                            "location_id": str(row.location_id),
                            "qty_change": str(-reserved_qty),
                            "movement_type": "unallocate",
                            "bulk_main_zero": True,
                            "bulk_main_zero_reserved": True,
                            "mode": mode,
                        },
                        ip_address=client_ip,
                    )
                    reserve_movements_created += 1
            _verify_non_negative_balances_or_raise(db, touched_rows)
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            raise
        movements_created = stock_movements_created + reserve_movements_created
        return MainZeroStockResponse(
            mode=mode,
            products_affected=len(product_ids),
            lots_affected=len(lot_ids),
            stock_movements_created=stock_movements_created,
            reserve_movements_created=reserve_movements_created,
            reserve_lots_affected=len(reserve_lot_ids),
            movements_created=movements_created,
            skipped=skipped,
        )

    return _run_with_idempotency(
        db=db,
        user_id=user.id,
        key=idempotency_key,
        scope="inventory_zero_main_stock",
        payload={"warehouse": "main", "mode": mode},
        expected_status=status.HTTP_200_OK,
        run=_run_zero_main,
    )


@router.get("/summary", response_model=List[InventorySummaryRow], summary="Inventory summary")
@router.get("/summary/", response_model=List[InventorySummaryRow], summary="Inventory summary")
async def inventory_summary(
    search: Optional[str] = None,
    product_ids: Optional[str] = Query(default=None, description="Comma-separated product UUIDs"),
    only_available: bool = Query(False),
    low_stock_threshold: Optional[Decimal] = Query(default=None, ge=0),
    warehouse: Optional[str] = Query(None, description="main or showroom — filter by warehouse (separate balance)"),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    on_hand_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
                StockMovementModel.qty_change,
            ),
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

    loc_ids = _location_ids_for_warehouse(db, warehouse)
    if loc_ids is not None:
        query = query.filter(StockMovementModel.location_id.in_(loc_ids))
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


def _fetch_locations_by_products(
    db: Session, product_ids: list[UUID], warehouse: Optional[str] = None
) -> dict[UUID, list]:
    """Fetch per-location breakdown for given product_ids. Returns {product_id: [rows]}."""
    if not product_ids:
        return {}
    loc_ids = _location_ids_for_warehouse(db, warehouse)
    on_hand_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
                StockMovementModel.qty_change,
            ),
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
    q = (
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
    )
    if loc_ids is not None:
        q = q.filter(StockMovementModel.location_id.in_(loc_ids))
    rows = (
        q.group_by(
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
    brand_ids: Optional[str] = Query(default=None, description="Comma-separated brand UUIDs"),
    only_available: bool = Query(True, description="Default true for fast load"),
    include_locations: bool = Query(True, description="Include location breakdown per product"),
    limit: int = Query(50, ge=1, le=10000),
    offset: int = Query(0, ge=0),
    warehouse: Optional[str] = Query(None, description="main or showroom — separate balance"),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    """Lightweight summary: product_id, name, brand, totals. Optional location breakdown. Paginated."""
    loc_ids = _location_ids_for_warehouse(db, warehouse)
    on_hand_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
                StockMovementModel.qty_change,
            ),
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
            ProductModel.brand_id.label("brand_id"),
            func.coalesce(ProductModel.brand, "").label("brand_name"),
            on_hand_expr.label("total_qty"),
            available_expr.label("available_qty"),
        )
        .join(StockLotModel, StockLotModel.product_id == ProductModel.id)
        .join(StockMovementModel, StockMovementModel.lot_id == StockLotModel.id)
        .group_by(
            ProductModel.id,
            ProductModel.name,
            ProductModel.sku,
            ProductModel.barcode,
            ProductModel.brand_id,
            ProductModel.brand,
        )
    )
    if loc_ids is not None:
        base_query = base_query.filter(StockMovementModel.location_id.in_(loc_ids))
    if search:
        base_query = _apply_product_search(base_query, search)
    if brand_ids:
        try:
            parsed_brand_ids = [UUID(token.strip()) for token in brand_ids.split(",") if token.strip()]
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid brand_ids") from exc
        if parsed_brand_ids:
            base_query = base_query.filter(ProductModel.brand_id.in_(parsed_brand_ids))
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
        locs_map = _fetch_locations_by_products(db, product_ids, warehouse)
    items = [
        InventorySummaryLightRow(
            product_id=row.product_id,
            product_name=row.product_name,
            product_code=row.product_code,
            barcode=row.barcode if row.barcode else None,
            brand_id=row.brand_id if row.brand_id else None,
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
    warehouse: Optional[str] = Query(None, description="main or showroom"),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    """Per-location details for one product. Call when user expands row."""
    loc_ids = _location_ids_for_warehouse(db, warehouse)
    on_hand_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
                StockMovementModel.qty_change,
            ),
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

    q = (
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
    )
    if loc_ids is not None:
        q = q.filter(StockMovementModel.location_id.in_(loc_ids))
    rows = (
        q
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
    warehouse: Optional[str] = Query(None, description="main or showroom — separate balance"),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    loc_ids = _location_ids_for_warehouse(db, warehouse)
    on_hand_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
                StockMovementModel.qty_change,
            ),
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
    if loc_ids is not None:
        query = query.filter(StockMovementModel.location_id.in_(loc_ids))
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
            (
                StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
                StockMovementModel.qty_change,
            ),
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
    warehouse: Optional[str] = Query(None, description="main or showroom — separate balance"),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    loc_ids = _location_ids_for_warehouse(db, warehouse)
    on_hand_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
                StockMovementModel.qty_change,
            ),
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
    if loc_ids is not None:
        query = query.filter(StockMovementModel.location_id.in_(loc_ids))
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
    warehouse: Optional[str] = Query(None, description="main or showroom — separate balance"),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    loc_ids = _location_ids_for_warehouse(db, warehouse)
    qty_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
                StockMovementModel.qty_change,
            ),
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
    if loc_ids is not None:
        query = query.filter(StockMovementModel.location_id.in_(loc_ids))
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

    # Qoldiq: jismoniy on_hand harakatlari; reservation esa alohida.
    on_hand = sum(
        (m.qty_change for m in movements if m.movement_type in PHYSICAL_ON_HAND_MOVEMENT_TYPES),
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
        f"Qoldiq hisobi: jismoniy harakatlar (opening/receipt/putaway/pick/ship/adjust/transfer). "
        f"Kirim: {receipt_sum}, Jo'natish: {ship_sum} → on_hand={on_hand}, reserved={reserved}, available={available}."
    )
    if pick_count >= 2:
        summary += (
            f" Eslatma: {pick_count} ta terish (pick) yozuvi bor; bu harakatlar jismoniy on_handga kiritiladi."
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


@router.get(
    "/negative-balance-check",
    response_model=NegativeBalanceCheckOut,
    summary="Manfiy qoldiq qatorlarini tekshirish (read-only)",
)
async def negative_balance_check(
    product_id: Optional[UUID] = Query(None),
    warehouse: Optional[str] = Query(None, description="main | showroom"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("inventory:read")),
):
    on_hand_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
                StockMovementModel.qty_change,
            ),
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
    query = (
        db.query(
            StockLotModel.product_id.label("product_id"),
            ProductModel.sku.label("sku"),
            StockMovementModel.location_id.label("location_id"),
            LocationModel.code.label("location_code"),
            StockLotModel.id.label("lot_id"),
            StockLotModel.batch.label("batch"),
            StockLotModel.expiry_date.label("expiry_date"),
            on_hand_expr.label("on_hand"),
            reserved_expr.label("reserved"),
            available_expr.label("available"),
        )
        .join(StockLotModel, StockLotModel.id == StockMovementModel.lot_id)
        .join(ProductModel, ProductModel.id == StockLotModel.product_id)
        .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
        .group_by(
            StockLotModel.product_id,
            ProductModel.sku,
            StockMovementModel.location_id,
            LocationModel.code,
            StockLotModel.id,
            StockLotModel.batch,
            StockLotModel.expiry_date,
        )
        .having((on_hand_expr < 0) | (available_expr < 0))
    )
    if product_id is not None:
        query = query.filter(StockLotModel.product_id == product_id)
    loc_ids = _location_ids_for_warehouse(db, warehouse) if warehouse else None
    if loc_ids is not None:
        if not loc_ids:
            return NegativeBalanceCheckOut(total_rows=0, rows=[])
        query = query.filter(StockMovementModel.location_id.in_(loc_ids))

    rows = query.order_by(available_expr.asc(), on_hand_expr.asc()).limit(limit).all()
    result = [
        NegativeBalanceRow(
            product_id=r.product_id,
            sku=r.sku,
            location_id=r.location_id,
            location_code=r.location_code,
            lot_id=r.lot_id,
            batch=r.batch,
            expiry_date=r.expiry_date,
            on_hand=Decimal(str(r.on_hand)),
            reserved=Decimal(str(r.reserved)),
            available=Decimal(str(r.available)),
        )
        for r in rows
    ]
    return NegativeBalanceCheckOut(total_rows=len(result), rows=result)


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
    _user=Depends(require_permission("maintenance:write")),
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


@router.get(
    "/smartup-balance",
    response_model=None,
    summary="SmartUP balance$export (cache, refresh, warehouse_code, filial_id)",
)
async def get_smartup_balance(
    refresh: bool = Query(False, description="Yuklash tugmasi: SmartUP dan yangilash"),
    warehouse_code: str = Query("001", description="001 = qoldiq, 002 = bron"),
    filial_id: str | None = Query(None, description="Filial ID (header). all = barcha filiallar birlashtirilgan"),
    _user=Depends(require_permission("inventory:read")),
) -> Any:
    """
    SmartUP balance$export: warehouse_code va ixtiyoriy filial_id.
    refresh=False va bugungi cache bor bo'lsa cache qaytariladi.
    filial_id=all da barcha filiallar uchun so'rov va balance massivlari birlashtiriladi.
    """
    global _smartup_balance_cache
    today = date.today()
    today_str = today.isoformat()
    wh = (warehouse_code or "001").strip() or "001"
    fid_param = (filial_id or "").strip() or ""
    cache_key = (today_str, wh, fid_param)

    # Eski kunlar uchun cache ni tozalash
    to_remove = [k for k in _smartup_balance_cache if k[0] != today_str]
    for k in to_remove:
        del _smartup_balance_cache[k]

    if not refresh:
        if cache_key in _smartup_balance_cache:
            return _smartup_balance_cache[cache_key]
        disk_hit = read_smartup_balance_disk_cache(today_str, wh, fid_param)
        if disk_hit is not None:
            _smartup_balance_cache[cache_key] = disk_hit
            return disk_hit
        return {"balance": []}

    try:
        if fid_param.lower() == "all":
            all_balances: list[Any] = []
            for fid in get_filial_ids():
                part = await asyncio.to_thread(
                    smartup_balance_export.fetch_balance_from_smartup, fid, wh
                )
                if isinstance(part, dict) and "balance" in part and isinstance(part["balance"], list):
                    all_balances.extend(part["balance"])
            result = {"balance": all_balances}
        else:
            result = await asyncio.to_thread(
                smartup_balance_export.fetch_balance_from_smartup,
                fid_param if fid_param else None,
                wh,
            )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if isinstance(result, dict):
        _smartup_balance_cache[cache_key] = result
        write_smartup_balance_disk_cache(today_str, wh, fid_param, result)
    return result


router.include_router(picker_inventory.router)
