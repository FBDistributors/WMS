"""
Picker-only read-only inventory endpoints.
Optimized for mobile with FEFO ordering and barcode/location search.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
import logging
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, aliased

from app.auth.deps import get_current_user, require_any_permission
from app.db import get_db
from app.models.document import Document as DocumentModel
from app.models.location import Location as LocationModel
from app.models.order import Order as OrderModel
from app.models.location_box_placement import PLACEMENT_SEALED, LocationBoxPlacement
from app.models.product import Product as ProductModel
from app.models.product import ProductBarcode
from app.models.product_box import ProductBox
from app.models.stock import ON_HAND_MOVEMENT_TYPES
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.services.location_sector import load_sector, normalize_sector_input
from app.services.stock_availability import PHYSICAL_ON_HAND_MOVEMENT_TYPES
from app.models.user import User as UserModel
from app.services.box_location_service import SealedBoxInfo, get_breakdown_map_for_product
from app.services.stock_availability import compute_lot_location_balances
from app.services.expired_zone_labels import get_labels_row, resolve_expired_display_label
from app.services.product_scan_resolve import resolve_product_scan

router = APIRouter()
logger = logging.getLogger(__name__)

# Picker/operator/manager read-only access (not admin inventory management)
PICKER_INVENTORY_PERMISSION = require_any_permission(["picking:read", "inventory:read"])

PHYSICAL_ON_HAND_MOVEMENT_TYPES = tuple(
    movement for movement in ON_HAND_MOVEMENT_TYPES if movement not in ("allocate", "unallocate")
)


def _get_showroom_root_id(db: Session) -> Optional[UUID]:
    """Return the id of the Showroom warehouse root location, or None if not found."""
    row = (
        db.query(LocationModel.id)
        .filter(LocationModel.code == "SHOWROOM", LocationModel.type == "warehouse")
        .one_or_none()
    )
    return row[0] if row else None


def _location_ids_for_warehouse(db: Session, warehouse: Optional[str]) -> Optional[list[UUID]]:
    """Return list of location ids for main or showroom, or None for no filter."""
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


def _aggregate_sealed_boxes(sealed: list[SealedBoxInfo]) -> list[PickerSealedBoxLine]:
    counts: dict[tuple[str, int], int] = {}
    for item in sealed:
        code = (item.box_barcode or "").strip()
        if not code:
            continue
        upb = int(item.units_per_box)
        key = (code, upb)
        counts[key] = counts.get(key, 0) + 1
    return [
        PickerSealedBoxLine(box_barcode=code, units_per_box=upb, count=cnt)
        for (code, upb), cnt in sorted(counts.items(), key=lambda row: row[0][0])
    ]


class PickerLotInfo(BaseModel):
    location_code: str
    batch_no: str
    expiry_date: date | None
    available_qty: Decimal
    reserved_qty: Decimal


class PickerInventoryItem(BaseModel):
    product_id: UUID
    name: str
    code: str
    main_barcode: str | None
    best_location: str | None
    on_hand_qty: Decimal
    available_qty: Decimal
    nearest_expiry: date | None
    top_locations: list[PickerLotInfo]


class PickerInventoryListResponse(BaseModel):
    items: list[PickerInventoryItem]
    next_cursor: str | None


class PickerSealedBoxLine(BaseModel):
    box_barcode: str
    units_per_box: int
    count: int = 1


class PickerProductLocation(BaseModel):
    location_id: UUID
    location_code: str
    lot_id: UUID
    batch_no: str
    expiry_date: date | None
    on_hand_qty: Decimal
    reserved_qty: Decimal
    available_qty: Decimal
    box_count: int = 0
    units_in_boxes: int = 0
    loose_units: int = 0
    sealed_boxes: list[PickerSealedBoxLine] = []


class PickerProductDetailResponse(BaseModel):
    product_id: UUID
    name: str
    code: str
    main_barcode: str | None
    locations: list[PickerProductLocation]


class PickerLocationOption(BaseModel):
    id: UUID
    code: str
    name: str
    zone_type: str = "NORMAL"
    expired_slot: Optional[str] = None
    expired_display_label: Optional[int] = None


class ByBarcodeLocationInfo(BaseModel):
    location_code: str
    available_qty: Decimal


class ByBarcodeLotInfo(BaseModel):
    batch_no: str
    expiry_date: date | None
    available_qty: Decimal


class InventoryByBarcodeResponse(BaseModel):
    product_id: str
    name: str
    barcode: str | None
    brand: str | None
    best_locations: list[ByBarcodeLocationInfo]
    fefo_lots: list[ByBarcodeLotInfo]
    total_available: Decimal
    scan_kind: str = "unit"
    scanned_barcode: str | None = None
    units_per_box: int | None = None
    box_barcode: str | None = None


def _get_product_main_barcode(db: Session, product: ProductModel) -> str | None:
    if product.barcode:
        return product.barcode
    b = db.query(ProductBarcode.barcode).filter(ProductBarcode.product_id == product.id).first()
    return b[0] if b else None


def _get_lot_level_balances(
    db: Session,
    product_ids: list[UUID] | None,
    location_id: Optional[UUID] = None,
    location_ids: Optional[list[UUID]] = None,
) -> list[dict[str, Any]]:
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
        .group_by(
            StockLotModel.product_id,
            StockLotModel.id,
            StockLotModel.batch,
            StockLotModel.expiry_date,
            StockMovementModel.location_id,
            LocationModel.code,
        )
        .having(on_hand_expr - reserved_expr != 0        )
    )
    if product_ids is not None:
        query = query.filter(StockLotModel.product_id.in_(product_ids))
    if location_id:
        query = query.filter(StockMovementModel.location_id == location_id)
    elif location_ids is not None:
        query = query.filter(StockMovementModel.location_id.in_(location_ids))
    rows = (
        query.order_by(StockLotModel.expiry_date.asc().nullslast(), StockLotModel.batch.asc())
        .all()
    )
    return [row._asdict() for row in rows]


def _append_sealed_only_pairs(
    db: Session,
    product_id: UUID,
    lot_data: list[dict],
    *,
    location_id: Optional[UUID] = None,
    location_ids: Optional[list[UUID]] = None,
) -> list[dict]:
    """Sealed qutisi bor, lekin `available == 0` bo'lgani uchun balans
    ro'yxatidan tushib qolgan lot/joy juftliklarini qo'shadi.

    Drift holatida (qutidagi dona > fizik qoldiq, qoldiq 0) joy aks holda
    inventarizatsiya oqimida umuman ko'rinmaydi — sanoq bilan tuzatib
    bo'lmay qoladi.
    """
    seen = {(r["lot_id"], r["location_id"]) for r in lot_data}
    query = (
        db.query(
            StockLotModel.product_id,
            LocationBoxPlacement.lot_id,
            StockLotModel.batch,
            StockLotModel.expiry_date,
            LocationBoxPlacement.location_id,
            LocationModel.code.label("location_code"),
        )
        .join(StockLotModel, StockLotModel.id == LocationBoxPlacement.lot_id)
        .join(LocationModel, LocationModel.id == LocationBoxPlacement.location_id)
        .join(ProductBox, ProductBox.id == LocationBoxPlacement.product_box_id)
        .filter(
            StockLotModel.product_id == product_id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
            ProductBox.is_active == True,
            LocationModel.is_active == True,
        )
        .distinct()
    )
    if location_id:
        query = query.filter(LocationBoxPlacement.location_id == location_id)
    elif location_ids is not None:
        query = query.filter(LocationBoxPlacement.location_id.in_(location_ids))
    extra: list[dict] = []
    for row in query.all():
        key = (row.lot_id, row.location_id)
        if key in seen:
            continue
        seen.add(key)
        on_hand, reserved, available = compute_lot_location_balances(
            db, row.lot_id, row.location_id
        )
        extra.append(
            {
                "product_id": row.product_id,
                "lot_id": row.lot_id,
                "batch": row.batch,
                "expiry_date": row.expiry_date,
                "location_id": row.location_id,
                "location_code": row.location_code,
                "on_hand": on_hand,
                "reserved": reserved,
                "available": available,
            }
        )
    return lot_data + extra


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
        total_on_hand = sum(Decimal(str(r["on_hand"])) for r in lots)
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
                code=p.sku or str(p.id),
                main_barcode=main_barcode,
                best_location=best_location,
                on_hand_qty=total_on_hand,
                available_qty=total_available,
                nearest_expiry=nearest_expiry,
                top_locations=top_locs,
            )
        )
    return items


def _get_product_by_barcode(db: Session, barcode: str) -> ProductModel | None:
    """Find product by barcode, SKU, or smartup_code (for manual entry)."""
    barcode = (barcode or "").strip()
    if not barcode:
        return None
    key = barcode.casefold()
    product = (
        db.query(ProductModel)
        .filter(
            or_(
                func.lower(ProductModel.barcode) == key,
                func.lower(ProductModel.sku) == key,
                func.lower(ProductModel.smartup_code) == key,
                ProductModel.id.in_(
                    db.query(ProductBarcode.product_id).filter(
                        func.lower(ProductBarcode.barcode) == key
                    )
                ),
            )
        )
        .filter(ProductModel.is_active == True)
        .first()
    )
    return product


@router.get(
    "/by-barcode/{barcode}",
    response_model=InventoryByBarcodeResponse,
    summary="Inventory by barcode (picker-friendly)",
)
async def get_inventory_by_barcode(
    barcode: str,
    db: Session = Depends(get_db),
    _user: UserModel = Depends(get_current_user),
    _guard=Depends(PICKER_INVENTORY_PERMISSION),
):
    scanned = (barcode or "").strip()
    scan_kind = "unit"
    units_per_box: int | None = None
    box_barcode: str | None = None
    resolved = resolve_product_scan(db, scanned)
    if resolved:
        product = resolved.product
        scan_kind = resolved.scan_kind
        if resolved.scan_kind == "box":
            units_per_box = resolved.units_per_scan
            box_barcode = scanned
    else:
        product = _get_product_by_barcode(db, scanned)
        if not product:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    main_barcode = _get_product_main_barcode(db, product)
    lot_data = _get_lot_level_balances(db, [product.id])
    total = sum(Decimal(str(r["available"])) for r in lot_data)
    loc_map: dict[str, Decimal] = {}
    fefo_lots: list[dict] = []
    for r in lot_data:
        loc_map[r["location_code"]] = loc_map.get(r["location_code"], Decimal(0)) + Decimal(
            str(r["available"])
        )
        fefo_lots.append(
            {
                "batch_no": r["batch"],
                "expiry_date": r["expiry_date"],
                "available_qty": Decimal(str(r["available"])),
            }
        )
    best_locations = [
        ByBarcodeLocationInfo(location_code=code, available_qty=qty)
        for code, qty in sorted(loc_map.items(), key=lambda x: -x[1])[:3]
    ]
    return InventoryByBarcodeResponse(
        product_id=str(product.id),
        name=product.name,
        barcode=main_barcode,
        brand=product.brand,
        best_locations=best_locations,
        fefo_lots=[ByBarcodeLotInfo(**lot) for lot in fefo_lots],
        total_available=total,
        scan_kind=scan_kind,
        scanned_barcode=scanned or None,
        units_per_box=units_per_box,
        box_barcode=box_barcode,
    )


class LocationContentsItem(BaseModel):
    product_id: str
    lot_id: str
    location_id: str
    product_name: str
    product_code: str
    barcode: str | None
    batch_no: str
    expiry_date: date | None
    available_qty: Decimal


class SectorLocationOut(BaseModel):
    id: str
    code: str
    items_count: int
    #: Rezervdagi tovar bor — sanab bo'lmaydi (terish paytida javondan ketishi mumkin).
    blocked: bool = False
    blocking_orders: list[str] = []


class SectorContentsResponse(BaseModel):
    sector: str
    locations: list[SectorLocationOut]
    blocked_count: int


class LocationContentsResponse(BaseModel):
    location_id: str
    location_code: str
    items: list[LocationContentsItem]


def _reserved_location_ids(db: Session, location_ids: list[UUID]) -> dict[UUID, Decimal]:
    """Joy bo'yicha sof rezerv (allocate - unallocate); faqat > 0 bo'lganlari."""
    if not location_ids:
        return {}
    rows = (
        db.query(
            StockMovementModel.location_id,
            func.coalesce(func.sum(StockMovementModel.qty_change), 0).label("reserved"),
        )
        .filter(
            StockMovementModel.location_id.in_(location_ids),
            StockMovementModel.movement_type.in_(("allocate", "unallocate")),
        )
        .group_by(StockMovementModel.location_id)
        .all()
    )
    return {r.location_id: Decimal(str(r.reserved)) for r in rows if Decimal(str(r.reserved)) > 0}


def _blocking_order_numbers(db: Session, location_id: UUID) -> list[str]:
    """Joyni band qilib turgan buyurtma raqamlari — sanoqchiga sabab ko'rsatish uchun."""
    doc = aliased(DocumentModel)
    order_id_expr = case(
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
                doc.order_id.isnot(None),
            ),
            doc.order_id,
        ),
        else_=None,
    )
    rows = (
        db.query(OrderModel.order_number)
        .select_from(StockMovementModel)
        .outerjoin(
            doc,
            and_(
                StockMovementModel.source_document_type == "document",
                StockMovementModel.source_document_id == doc.id,
            ),
        )
        .join(OrderModel, OrderModel.id == order_id_expr)
        .filter(
            StockMovementModel.location_id == location_id,
            StockMovementModel.movement_type == "allocate",
        )
        .distinct()
        .limit(5)
        .all()
    )
    return [r[0] for r in rows if r[0]]


@router.get(
    "/sector/{sector}",
    response_model=SectorContentsResponse,
    summary="Sektor ichidagi joylar (inventarizatsiya uchun)",
)
async def get_sector_contents(
    sector: str,
    db: Session = Depends(get_db),
    _user: UserModel = Depends(get_current_user),
    _guard=Depends(PICKER_INVENTORY_PERMISSION),
):
    """Sektorning barcha joylari, har birida nechta qator borligi va band-bandligi.

    Rezervdagi joy sanalmaydi: tovar terish uchun band qilingan, ya'ni sanoq
    paytida javondan ketishi mumkin — sanoq natijasi yolg'on chiqadi.
    """
    info = load_sector(db, normalize_sector_input(sector))
    location_ids = [loc.id for loc in info.locations]
    reserved = _reserved_location_ids(db, location_ids)

    counts = dict(
        db.query(
            StockMovementModel.location_id,
            func.count(func.distinct(StockMovementModel.lot_id)),
        )
        .filter(
            StockMovementModel.location_id.in_(location_ids),
            StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
        )
        .group_by(StockMovementModel.location_id)
        .all()
    )

    out: list[SectorLocationOut] = []
    for loc in info.locations:
        is_blocked = loc.id in reserved
        out.append(
            SectorLocationOut(
                id=str(loc.id),
                code=loc.code,
                items_count=int(counts.get(loc.id, 0)),
                blocked=is_blocked,
                blocking_orders=_blocking_order_numbers(db, loc.id) if is_blocked else [],
            )
        )
    return SectorContentsResponse(
        sector=info.prefix,
        locations=out,
        blocked_count=sum(1 for o in out if o.blocked),
    )


@router.get(
    "/location/{location_code_or_barcode}",
    response_model=LocationContentsResponse,
    summary="Contents of location by code or barcode",
)
async def get_location_contents(
    location_code_or_barcode: str,
    db: Session = Depends(get_db),
    _user: UserModel = Depends(get_current_user),
    _guard=Depends(PICKER_INVENTORY_PERMISSION),
):
    code = (location_code_or_barcode or "").strip()
    location = (
        db.query(LocationModel)
        .filter(LocationModel.code == code)
        .filter(LocationModel.is_active == True)
        .first()
    )
    if not location:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")
    lot_data = _get_lot_level_balances(db, product_ids=None, location_id=location.id)
    # Drift mahsulotlari (sealed quti bor, qoldiq 0) joy tarkibida ko'rinsin.
    sealed_products = (
        db.query(StockLotModel.product_id)
        .join(LocationBoxPlacement, LocationBoxPlacement.lot_id == StockLotModel.id)
        .join(ProductBox, ProductBox.id == LocationBoxPlacement.product_box_id)
        .filter(
            LocationBoxPlacement.location_id == location.id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
            ProductBox.is_active == True,
        )
        .distinct()
        .all()
    )
    for (pid,) in sealed_products:
        lot_data = _append_sealed_only_pairs(db, pid, lot_data, location_id=location.id)
    product_ids = list({r["product_id"] for r in lot_data})
    products = {p.id: p for p in db.query(ProductModel).filter(ProductModel.id.in_(product_ids)).all()}
    items = []
    for r in lot_data:
        p = products.get(r["product_id"])
        main_barcode = _get_product_main_barcode(db, p) if p else None
        items.append(
            LocationContentsItem(
                product_id=str(r["product_id"]),
                lot_id=str(r["lot_id"]),
                location_id=str(location.id),
                product_name=p.name if p else "?",
                product_code=(p.sku or str(r["product_id"])) if p else str(r["product_id"]),
                barcode=main_barcode,
                batch_no=r["batch"],
                expiry_date=r["expiry_date"],
                available_qty=Decimal(str(r["available"])),
            )
        )
    return LocationContentsResponse(
        location_id=str(location.id),
        location_code=location.code,
        items=items,
    )


@router.get(
    "/picker/locations",
    response_model=list[PickerLocationOption],
    summary="List locations for picker filter",
)
async def list_picker_locations(
    warehouse: Optional[str] = Query(None, description="main | showroom — filter by warehouse for receiving"),
    db: Session = Depends(get_db),
    _user: UserModel = Depends(get_current_user),
    _guard=Depends(PICKER_INVENTORY_PERMISSION),
):
    # Exclude warehouse root (e.g. SHOWROOM) so only concrete putaway locations appear (main + showroom racks like S-01-02).
    query = db.query(LocationModel).filter(LocationModel.is_active == True).filter(LocationModel.type != "warehouse")
    if warehouse == "main":
        query = query.filter(LocationModel.warehouse_id.is_(None))
    elif warehouse == "showroom":
        showroom_id = _get_showroom_root_id(db)
        if showroom_id is None:
            return []
        query = query.filter(LocationModel.warehouse_id == showroom_id)
    rows = query.order_by(LocationModel.code).all()
    labels_row = get_labels_row(db)
    return [
        PickerLocationOption(
            id=r.id,
            code=r.code,
            name=r.name,
            zone_type=r.zone_type or "NORMAL",
            expired_slot=r.expired_slot,
            expired_display_label=resolve_expired_display_label(r.zone_type, r.expired_slot, labels_row),
        )
        for r in rows
    ]


@router.get(
    "/picker/brands",
    response_model=list[str],
    summary="Distinct brand names for picker filter",
)
async def list_picker_brands(
    db: Session = Depends(get_db),
    _user: UserModel = Depends(get_current_user),
    _guard=Depends(PICKER_INVENTORY_PERMISSION),
):
    """Distinct, non-empty brand names across active products (for the inventory filter sheet).

    Kept picker-accessible on purpose: the admin `/brands` endpoint requires
    `admin:access`, which pickers/controllers do not have.
    """
    rows = (
        db.query(ProductModel.brand)
        .filter(ProductModel.is_active == True)
        .filter(ProductModel.brand.isnot(None))
        .filter(func.trim(ProductModel.brand) != "")
        .distinct()
        .order_by(ProductModel.brand.asc())
        .all()
    )
    return [r[0] for r in rows]


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
    brand: Optional[str] = Query(None, description="Filter by exact brand name"),
    warehouse: Optional[str] = Query(None, description="main | showroom — filter by warehouse (qoldiq qayerda)"),
    limit: int = Query(20, ge=1, le=100),
    cursor: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _user: UserModel = Depends(get_current_user),
    _guard=Depends(PICKER_INVENTORY_PERMISSION),
):
    query = db.query(ProductModel).filter(ProductModel.is_active == True)
    if brand and brand.strip():
        query = query.filter(ProductModel.brand == brand.strip())
    if q:
        term = f"%{q.strip()}%"

        barcode_subq = (
            db.query(ProductBarcode.product_id)
            .filter(ProductBarcode.barcode.ilike(term))
        )
        query = query.filter(
            or_(
                func.lower(ProductModel.name).ilike(func.lower(term)),
                func.lower(ProductModel.sku).ilike(func.lower(term)),
                ProductModel.barcode.ilike(term),
                func.lower(ProductModel.smartup_code).ilike(func.lower(term)),
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
    # Joy/ombor filtri mahsulotlar ro'yxatining o'zini ham cheklashi kerak —
    # aks holda joyda yo'q mahsulotlar 0 qoldiq bilan chiqadi.
    loc_ids = _location_ids_for_warehouse(db, warehouse) if not location_id else None
    if location_id or loc_ids is not None:
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
        stocked_subq = db.query(StockLotModel.product_id).join(
            StockMovementModel, StockMovementModel.lot_id == StockLotModel.id
        )
        if location_id:
            stocked_subq = stocked_subq.filter(StockMovementModel.location_id == location_id)
        else:
            stocked_subq = stocked_subq.filter(StockMovementModel.location_id.in_(loc_ids))
        stocked_subq = stocked_subq.group_by(
            StockLotModel.product_id, StockLotModel.id, StockMovementModel.location_id
        ).having(on_hand_expr - reserved_expr != 0)
        query = query.filter(ProductModel.id.in_(stocked_subq))
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
    lot_data = _get_lot_level_balances(db, product_ids, location_id, location_ids=loc_ids)
    items = _build_picker_items(db, products, lot_data, top_n=3)
    return PickerInventoryListResponse(items=items, next_cursor=next_cursor)


@router.get(
    "/picker/{product_id}",
    response_model=PickerProductDetailResponse,
    summary="Picker product detail (full breakdown)",
)
async def get_picker_product_detail(
    product_id: UUID,
    warehouse: Optional[str] = Query(None, description="main | showroom — filter locations by warehouse"),
    db: Session = Depends(get_db),
    _user: UserModel = Depends(get_current_user),
    _guard=Depends(PICKER_INVENTORY_PERMISSION),
):
    product = db.query(ProductModel).filter(ProductModel.id == product_id).one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    loc_ids = _location_ids_for_warehouse(db, warehouse) if warehouse else None
    lot_data = _get_lot_level_balances(db, [product_id], location_ids=loc_ids)
    # Drift joylari (sealed quti bor, qoldiq 0) sanoq uchun ko'rinsin.
    lot_data = _append_sealed_only_pairs(db, product_id, lot_data, location_ids=loc_ids)
    main_barcode = _get_product_main_barcode(db, product)
    breakdown_map = get_breakdown_map_for_product(
        db,
        product_id,
        [(r["lot_id"], r["location_id"]) for r in lot_data],
    )
    locations: list[PickerProductLocation] = []
    negative_rows = 0
    for r in lot_data:
        on_hand = Decimal(str(r["on_hand"]))
        reserved = Decimal(str(r["reserved"]))
        available = Decimal(str(r["available"]))
        if on_hand < 0 or available < 0:
            negative_rows += 1
        bd = breakdown_map.get((r["lot_id"], r["location_id"]))
        locations.append(
            PickerProductLocation(
                location_id=r["location_id"],
                location_code=r["location_code"],
                lot_id=r["lot_id"],
                batch_no=r["batch"],
                expiry_date=r["expiry_date"],
                on_hand_qty=on_hand,
                reserved_qty=reserved,
                available_qty=available,
                box_count=bd.box_count if bd else 0,
                units_in_boxes=bd.units_in_boxes if bd else 0,
                loose_units=bd.loose_units if bd else int(available) if available > 0 else 0,
                sealed_boxes=_aggregate_sealed_boxes(bd.sealed_boxes if bd else []),
            )
        )
    if negative_rows:
        logger.warning(
            "Negative stock balances detected in picker detail",
            extra={
                "product_id": str(product_id),
                "warehouse": warehouse,
                "negative_rows": negative_rows,
            },
        )
    return PickerProductDetailResponse(
        product_id=product.id,
        name=product.name,
        code=product.sku or str(product.id),
        main_barcode=main_barcode,
        locations=locations,
    )
