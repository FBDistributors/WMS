"""Wave picking + sorting zone API."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, joinedload, selectinload

from app.auth.deps import get_current_user, require_permission
from app.db import get_db
from app.models.document import Document as DocumentModel
from app.models.location import Location as LocationModel
from app.models.order import Order as OrderModel
from app.models.order import OrderLine as OrderLineModel
from app.models.product import Product as ProductModel
from app.models.product import ProductBarcode
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.models.user import User as UserModel
from app.models.wave import (
    SortingBin,
    SortingScan,
    Wave,
    WaveAllocation,
    WaveLine,
    WaveOrder,
    WavePickScan,
)
from app.services.audit_service import ACTION_CREATE, ACTION_UPDATE, get_client_ip, log_action
from app.services.wave_service import (
    STAGING_LOCATION_CODE,
    compute_wave_lines,
    get_staging_location_id,
)

router = APIRouter()


# --- Schemas ---

class WaveCreateIn(BaseModel):
    order_ids: List[UUID] = Field(..., min_length=1)
    note: Optional[str] = Field(default=None, max_length=512)


class WaveOrderOut(BaseModel):
    id: UUID
    order_id: UUID
    order_number: str
    source_external_id: str


class WaveLineAllocationOut(BaseModel):
    lot_id: UUID
    location_id: UUID
    location_code: str
    batch: str
    expiry_date: Optional[datetime]
    allocated_qty: Decimal
    picked_qty: Decimal


class WaveLineOut(BaseModel):
    id: UUID
    product_id: UUID
    barcode: str
    total_qty: Decimal
    picked_qty: Decimal
    status: str
    product_name: Optional[str] = None
    product_sku: Optional[str] = None
    brand: Optional[str] = None
    allocations: Optional[List[WaveLineAllocationOut]] = None


class WaveOut(BaseModel):
    id: UUID
    wave_number: str
    status: str
    created_by: Optional[UUID] = None
    note: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    orders: List[WaveOrderOut] = []
    lines: List[WaveLineOut] = []
    bins: Optional[List[dict]] = None


class WaveListOut(BaseModel):
    items: List[WaveOut]
    total: int
    limit: int
    offset: int


class PickScanIn(BaseModel):
    barcode: str = Field(..., min_length=1)
    qty: Decimal = Field(..., gt=0)
    request_id: UUID


class SortingScanIn(BaseModel):
    order_id: UUID
    barcode: str = Field(..., min_length=1)
    qty: Decimal = Field(..., gt=0)
    request_id: UUID


def _resolve_product_by_barcode(db: Session, barcode: str) -> Optional[UUID]:
    p = db.query(ProductModel.id).filter(ProductModel.barcode == barcode).one_or_none()
    if p:
        return p.id
    p = (
        db.query(ProductModel.id)
        .join(ProductBarcode, ProductBarcode.product_id == ProductModel.id)
        .filter(ProductBarcode.barcode == barcode)
        .one_or_none()
    )
    return p.id if p else None


def _get_barcode_for_product(db: Session, product_id: UUID) -> Optional[str]:
    product = db.query(ProductModel).filter(ProductModel.id == product_id).one_or_none()
    if not product:
        return None
    if product.barcode:
        return product.barcode
    b = db.query(ProductBarcode.barcode).filter(ProductBarcode.product_id == product_id).first()
    return b.barcode if b else None


def _generate_wave_number(db: Session) -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    r = db.execute(text("SELECT COUNT(*) FROM waves WHERE wave_number LIKE :prefix"), {"prefix": f"WAVE-{today}-%"})
    count = r.scalar() or 0
    return f"WAVE-{today}-{(count + 1):04d}"


@router.post("", response_model=WaveOut, status_code=status.HTTP_201_CREATED, summary="Create wave")
@router.post("/", response_model=WaveOut, status_code=status.HTTP_201_CREATED, summary="Create wave")
async def create_wave(
    request: Request,
    payload: WaveCreateIn,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _perm=Depends(require_permission("waves:create")),
):
    """Create wave in DRAFT with aggregated lines by product/barcode."""
    # Validate orders exist and not already in another wave
    orders = db.query(OrderModel).filter(OrderModel.id.in_(payload.order_ids)).all()
    if len(orders) != len(payload.order_ids):
        raise HTTPException(status_code=400, detail="One or more orders not found")
    for order in orders:
        existing = db.query(WaveOrder).filter(WaveOrder.order_id == order.id).first()
        if existing:
            wave = db.query(Wave).filter(Wave.id == existing.wave_id).one()
            raise HTTPException(
                status_code=409,
                detail=f"Order {order.order_number} already in wave {wave.wave_number}",
            )
        # Check order not already has picking document
        doc = db.query(DocumentModel).filter(DocumentModel.order_id == order.id).first()
        if doc:
            raise HTTPException(
                status_code=409,
                detail=f"Order {order.order_number} already has picking document",
            )

    wave_number = _generate_wave_number(db)
    wave = Wave(
        wave_number=wave_number,
        status="DRAFT",
        created_by=user.id,
        note=payload.note,
    )
    db.add(wave)
    db.flush()

    for order in orders:
        wo = WaveOrder(wave_id=wave.id, order_id=order.id)
        db.add(wo)

    # Compute aggregated lines
    lines_data = compute_wave_lines(db, payload.order_ids)
    for product_id, barcode, total_qty in lines_data:
        wl = WaveLine(
            wave_id=wave.id,
            product_id=product_id,
            barcode=barcode,
            total_qty=total_qty,
        )
        db.add(wl)

    # Create sorting bins
    for i, order in enumerate(orders, 1):
        bin_code = f"BIN-{i:03d}"
        sb = SortingBin(wave_id=wave.id, order_id=order.id, bin_code=bin_code)
        db.add(sb)

    log_action(
        db, user_id=user.id, action=ACTION_CREATE,
        entity_type="wave", entity_id=str(wave.id),
        new_data={"wave_number": wave_number, "order_count": len(orders), "lines_count": len(lines_data)},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(wave)
    return _to_wave_out(db, wave)


@router.get("", response_model=WaveListOut, summary="List waves")
@router.get("/", response_model=WaveListOut, summary="List waves")
async def list_waves(
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("waves:read")),
):
    query = db.query(Wave)
    if status:
        query = query.filter(Wave.status == status)
    total = query.count()
    waves = query.order_by(Wave.created_at.desc()).offset(offset).limit(limit).all()
    items = [_to_wave_out(db, w) for w in waves]
    return WaveListOut(items=items, total=total, limit=limit, offset=offset)


@router.get("/{wave_id}", response_model=WaveOut, summary="Get wave details")
async def get_wave(
    wave_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("waves:read")),
):
    wave = db.query(Wave).filter(Wave.id == wave_id).one_or_none()
    if not wave:
        raise HTTPException(status_code=404, detail="Wave not found")
    return _to_wave_out(db, wave, include_allocations=wave.status in ("PICKING", "SORTING", "COMPLETED"))


@router.post("/{wave_id}/start", response_model=WaveOut, summary="Start wave (FEFO allocation)")
async def start_wave(
    request: Request,
    wave_id: UUID,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _perm=Depends(require_permission("waves:manage")),
):
    """Move wave to PICKING, perform FEFO allocation with row locking."""
    wave = db.query(Wave).filter(Wave.id == wave_id).one_or_none()
    if not wave:
        raise HTTPException(status_code=404, detail="Wave not found")
    if wave.status != "DRAFT":
        raise HTTPException(status_code=409, detail=f"Wave must be DRAFT, got {wave.status}")

    staging_id = get_staging_location_id(db)
    if not staging_id:
        raise HTTPException(status_code=500, detail=f"Staging location {STAGING_LOCATION_CODE} not found")

    from app.services.wave_service import _fefo_available_for_product

    for wl in wave.lines:
        rows = _fefo_available_for_product(db, wl.product_id)
        remaining = wl.total_qty
        for row in rows:
            if remaining <= 0:
                break
            avail = Decimal(str(row.available))
            if avail <= 0:
                continue
            allocate_qty = min(avail, remaining)
            wa = WaveAllocation(
                wave_line_id=wl.id,
                stock_lot_id=row.lot_id,
                location_id=row.location_id,
                allocated_qty=allocate_qty,
            )
            db.add(wa)
            db.add(
                StockMovementModel(
                    product_id=wl.product_id,
                    lot_id=row.lot_id,
                    location_id=row.location_id,
                    qty_change=allocate_qty,
                    movement_type="allocate",
                    source_document_type="wave",
                    source_document_id=wave.id,
                    created_by_user_id=user.id,
                )
            )
            remaining -= allocate_qty
        if remaining > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Insufficient stock for barcode {wl.barcode} (need {wl.total_qty}, short {remaining})",
            )

    wave.status = "PICKING"
    log_action(db, user_id=user.id, action=ACTION_UPDATE, entity_type="wave", entity_id=str(wave_id),
               old_data={"status": "DRAFT"}, new_data={"status": "PICKING"}, ip_address=get_client_ip(request))
    db.commit()
    db.refresh(wave)
    return _to_wave_out(db, wave, include_allocations=True)


@router.post("/{wave_id}/pick/scan", summary="Picker confirm pick by barcode")
async def pick_scan(
    request: Request,
    wave_id: UUID,
    payload: PickScanIn,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _perm=Depends(require_permission("waves:pick")),
):
    """Idempotent pick scan. Moves stock to staging."""
    wave = db.query(Wave).filter(Wave.id == wave_id).one_or_none()
    if not wave:
        raise HTTPException(status_code=404, detail="Wave not found")
    if wave.status != "PICKING":
        raise HTTPException(status_code=409, detail="Wave must be in PICKING status")

    existing = db.query(WavePickScan).filter(WavePickScan.request_id == payload.request_id).first()
    if existing:
        return {"status": "ok", "idempotent": True}

    wl = db.query(WaveLine).options(selectinload(WaveLine.allocations)).filter(
        WaveLine.wave_id == wave_id, WaveLine.barcode == payload.barcode.strip()
    ).first()
    if not wl:
        raise HTTPException(status_code=404, detail="Barcode not in wave")
    remaining = wl.total_qty - wl.picked_qty
    if payload.qty > remaining:
        raise HTTPException(status_code=400, detail=f"Qty {payload.qty} exceeds remaining {remaining}")

    staging_id = get_staging_location_id(db)
    if not staging_id:
        raise HTTPException(status_code=500, detail="Staging location not found")

    to_pick = payload.qty
    for wa in wl.allocations:
        if to_pick <= 0:
            break
        available = wa.allocated_qty - wa.picked_qty
        if available <= 0:
            continue
        pick_from_alloc = min(to_pick, available)
        wa.picked_qty += pick_from_alloc
        db.add(StockMovementModel(
            product_id=wl.product_id,
            lot_id=wa.stock_lot_id,
            location_id=wa.location_id,
            qty_change=-pick_from_alloc,
            movement_type="unallocate",
            source_document_type="wave",
            source_document_id=wave_id,
            created_by_user_id=user.id,
        ))
        db.add(StockMovementModel(
            product_id=wl.product_id,
            lot_id=wa.stock_lot_id,
            location_id=staging_id,
            qty_change=pick_from_alloc,
            movement_type="transfer_in",
            source_document_type="wave",
            source_document_id=wave_id,
            created_by_user_id=user.id,
        ))
        to_pick -= pick_from_alloc

    wl.picked_qty += payload.qty
    if wl.picked_qty >= wl.total_qty:
        wl.status = "PICKED"

    all_picked = all(line.status == "PICKED" for line in wave.lines)
    if all_picked:
        wave.status = "SORTING"

    db.add(WavePickScan(wave_id=wave_id, request_id=payload.request_id, barcode=payload.barcode, qty=payload.qty))
    log_action(db, user_id=user.id, action=ACTION_UPDATE, entity_type="wave_pick",
               entity_id=str(wave_id), new_data={"barcode": payload.barcode, "qty": str(payload.qty), "request_id": str(payload.request_id)},
               ip_address=get_client_ip(request))
    db.commit()
    return {"status": "ok", "remaining": float(wl.total_qty - wl.picked_qty), "wave_status": wave.status}


@router.post("/{wave_id}/sorting/scan", summary="Sorting zone scan")
async def sorting_scan(
    request: Request,
    wave_id: UUID,
    payload: SortingScanIn,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _perm=Depends(require_permission("waves:sort")),
):
    """Idempotent sorting scan. Assigns scanned qty to order."""
    wave = db.query(Wave).filter(Wave.id == wave_id).one_or_none()
    if not wave:
        raise HTTPException(status_code=404, detail="Wave not found")
    if wave.status != "SORTING":
        raise HTTPException(status_code=409, detail="Wave must be in SORTING status")

    wo = db.query(WaveOrder).filter(WaveOrder.wave_id == wave_id, WaveOrder.order_id == payload.order_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Order not in wave")

    existing = db.query(SortingScan).filter(SortingScan.request_id == payload.request_id).first()
    if existing:
        return {"status": "ok", "idempotent": True}

    scan = SortingScan(
        wave_id=wave_id,
        order_id=payload.order_id,
        barcode=payload.barcode.strip(),
        qty=payload.qty,
        scanned_by=user.id,
        request_id=payload.request_id,
    )
    db.add(scan)

    order_lines = db.query(OrderLineModel).filter(OrderLineModel.order_id == payload.order_id).all()
    product_id = _resolve_product_by_barcode(db, payload.barcode)
    if not product_id:
        raise HTTPException(status_code=404, detail="Barcode not found")
    required = sum(Decimal(str(l.qty)) for l in order_lines if (_resolve_product_by_barcode(db, l.barcode or "") == product_id or (l.sku and db.query(ProductModel).filter(ProductModel.sku == l.sku).first() and db.query(ProductModel).filter(ProductModel.sku == l.sku).first().id == product_id)))
    scanned_total = db.query(func.coalesce(func.sum(SortingScan.qty), 0)).filter(
        SortingScan.wave_id == wave_id,
        SortingScan.order_id == payload.order_id,
        SortingScan.barcode == payload.barcode,
    ).scalar() or 0
    if Decimal(str(scanned_total)) > required:
        raise HTTPException(status_code=400, detail="Scanned qty exceeds order requirement")

    bin = db.query(SortingBin).filter(SortingBin.wave_id == wave_id, SortingBin.order_id == payload.order_id).first()
    if bin:
        scanned_for_order = db.query(func.coalesce(func.sum(SortingScan.qty), 0)).filter(
            SortingScan.wave_id == wave_id,
            SortingScan.order_id == payload.order_id,
        ).scalar() or 0
        order_total = sum(Decimal(str(l.qty)) for l in order_lines)
        if Decimal(str(scanned_for_order)) >= order_total:
            bin.status = "DONE"

    log_action(db, user_id=user.id, action=ACTION_CREATE, entity_type="sorting_scan",
               entity_id=str(scan.id), new_data={"order_id": str(payload.order_id), "barcode": payload.barcode, "qty": str(payload.qty)},
               ip_address=get_client_ip(request))
    db.commit()
    return {"status": "ok"}


@router.post("/{wave_id}/complete", response_model=WaveOut, summary="Complete wave")
async def complete_wave(
    request: Request,
    wave_id: UUID,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _perm=Depends(require_permission("waves:manage")),
):
    wave = db.query(Wave).options(selectinload(Wave.bins)).filter(Wave.id == wave_id).one_or_none()
    if not wave:
        raise HTTPException(status_code=404, detail="Wave not found")
    if wave.status != "SORTING":
        raise HTTPException(status_code=409, detail="Wave must be in SORTING status")
    for b in (wave.bins or []):
        if b.status != "DONE":
            raise HTTPException(status_code=409, detail=f"Bin {b.bin_code} for order {b.order_id} not DONE")
    wave.status = "COMPLETED"
    log_action(db, user_id=user.id, action=ACTION_UPDATE, entity_type="wave", entity_id=str(wave_id),
               old_data={"status": "SORTING"}, new_data={"status": "COMPLETED"}, ip_address=get_client_ip(request))
    db.commit()
    db.refresh(wave)
    return _to_wave_out(db, wave)


def _to_wave_out(db: Session, wave: Wave, include_allocations: bool = False) -> WaveOut:
    wave = db.query(Wave).options(
        selectinload(Wave.orders).joinedload(WaveOrder.order),
        selectinload(Wave.lines).joinedload(WaveLine.product),
        selectinload(Wave.lines).joinedload(WaveLine.allocations).options(
            joinedload(WaveAllocation.lot),
            joinedload(WaveAllocation.location),
        ),
        selectinload(Wave.bins).joinedload(SortingBin.order),
    ).filter(Wave.id == wave.id).one()
    orders_out = [
        WaveOrderOut(id=wo.id, order_id=wo.order.id, order_number=wo.order.order_number, source_external_id=wo.order.source_external_id)
        for wo in wave.orders
    ]
    lines_out = []
    for wl in wave.lines:
        p = wl.product
        allocs = None
        if include_allocations and wl.allocations:
            allocs = [
                WaveLineAllocationOut(
                    lot_id=wa.stock_lot_id,
                    location_id=wa.location_id,
                    location_code=wa.location.code if wa.location else "",
                    batch=wa.lot.batch if wa.lot else "",
                    expiry_date=wa.lot.expiry_date if wa.lot else None,
                    allocated_qty=wa.allocated_qty,
                    picked_qty=wa.picked_qty,
                )
                for wa in wl.allocations
            ]
        lines_out.append(WaveLineOut(
            id=wl.id,
            product_id=wl.product_id,
            barcode=wl.barcode,
            total_qty=wl.total_qty,
            picked_qty=wl.picked_qty,
            status=wl.status,
            product_name=p.name if p else None,
            product_sku=p.sku if p else None,
            brand=p.brand if p else None,
            allocations=allocs,
        ))
    bins_out = [{"id": str(b.id), "order_id": str(b.order_id), "bin_code": b.bin_code, "status": b.status} for b in (wave.bins or [])]
    return WaveOut(
        id=wave.id,
        wave_number=wave.wave_number,
        status=wave.status,
        created_by=wave.created_by,
        note=wave.note,
        created_at=wave.created_at,
        updated_at=wave.updated_at,
        orders=orders_out,
        lines=lines_out,
        bins=bins_out,
    )
