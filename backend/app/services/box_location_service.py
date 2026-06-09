"""Lokatsiyada yopiq quti joylashuvi va qutisiz dona hisobi."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.models.location_box_placement import (
    PLACEMENT_REMOVED,
    PLACEMENT_SEALED,
    LocationBoxPlacement,
)
from app.models.product_box import ProductBox as ProductBoxModel
from app.models.stock import StockLot as StockLotModel
from app.models.user import User as UserModel
from app.services.product_scan_resolve import normalize_scan_barcode
from app.services.stock_availability import (
    compute_lot_location_available,
    lock_lot_location,
)


@dataclass(frozen=True)
class SealedBoxInfo:
    placement_id: UUID
    product_box_id: UUID
    box_barcode: str
    units_per_box: int
    label: str | None


@dataclass(frozen=True)
class LocationBoxBreakdown:
    product_id: UUID
    lot_id: UUID
    location_id: UUID
    box_count: int
    units_in_boxes: int
    loose_units: int
    total_units: int
    sealed_boxes: list[SealedBoxInfo]


def _units_in_boxes_for_lot_location(
    db: Session, lot_id: UUID, location_id: UUID
) -> tuple[int, int, list[SealedBoxInfo]]:
    rows = (
        db.query(LocationBoxPlacement)
        .options(joinedload(LocationBoxPlacement.product_box))
        .filter(
            LocationBoxPlacement.lot_id == lot_id,
            LocationBoxPlacement.location_id == location_id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
        )
        .all()
    )
    sealed: list[SealedBoxInfo] = []
    units = 0
    for row in rows:
        box = row.product_box
        if not box or not box.is_active:
            continue
        sealed.append(
            SealedBoxInfo(
                placement_id=row.id,
                product_box_id=box.id,
                box_barcode=box.box_barcode,
                units_per_box=box.units_per_box,
                label=box.label,
            )
        )
        units += box.units_per_box
    return len(sealed), units, sealed


def get_breakdown(
    db: Session,
    *,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
) -> LocationBoxBreakdown:
    lot = db.get(StockLotModel, lot_id)
    if not lot or lot.product_id != product_id:
        raise HTTPException(status_code=400, detail="Invalid lot for product")
    available = compute_lot_location_available(db, lot_id, location_id)
    total = max(0, int(available))
    box_count, units_in_boxes, sealed = _units_in_boxes_for_lot_location(db, lot_id, location_id)
    if units_in_boxes > total:
        raise HTTPException(
            status_code=409,
            detail="Qutilardagi dona jami qoldiqdan oshib ketgan (ma'lumot nomuvofiqligi)",
        )
    loose = total - units_in_boxes
    return LocationBoxBreakdown(
        product_id=product_id,
        lot_id=lot_id,
        location_id=location_id,
        box_count=box_count,
        units_in_boxes=units_in_boxes,
        loose_units=loose,
        total_units=total,
        sealed_boxes=sealed,
    )


def get_breakdown_map_for_product(
    db: Session,
    product_id: UUID,
    pairs: list[tuple[UUID, UUID]],
) -> dict[tuple[UUID, UUID], LocationBoxBreakdown]:
    if not pairs:
        return {}
    out: dict[tuple[UUID, UUID], LocationBoxBreakdown] = {}
    for lot_id, location_id in pairs:
        key = (lot_id, location_id)
        if key in out:
            continue
        try:
            out[key] = get_breakdown(
                db,
                product_id=product_id,
                lot_id=lot_id,
                location_id=location_id,
            )
        except HTTPException:
            available = compute_lot_location_available(db, lot_id, location_id)
            total = int(available) if available > 0 else 0
            out[key] = LocationBoxBreakdown(
                product_id=product_id,
                lot_id=lot_id,
                location_id=location_id,
                box_count=0,
                units_in_boxes=0,
                loose_units=total,
                total_units=total,
                sealed_boxes=[],
            )
    return out


def _get_product_box_by_barcode(db: Session, box_barcode: str) -> ProductBoxModel:
    code = normalize_scan_barcode(box_barcode)
    if not code:
        raise HTTPException(status_code=400, detail="box_barcode required")
    box = (
        db.query(ProductBoxModel)
        .filter(
            ProductBoxModel.box_barcode == code,
            ProductBoxModel.is_active.is_(True),
        )
        .one_or_none()
    )
    if not box:
        raise HTTPException(status_code=404, detail="Quti topilmadi")
    return box


def _find_sealed_at(
    db: Session,
    product_box_id: UUID,
    *,
    location_id: UUID | None = None,
    lot_id: UUID | None = None,
) -> LocationBoxPlacement | None:
    """FIFO: eng eski sealed placement (bir xil quti turi ko'p marta bo'lishi mumkin)."""
    q = db.query(LocationBoxPlacement).filter(
        LocationBoxPlacement.product_box_id == product_box_id,
        LocationBoxPlacement.status == PLACEMENT_SEALED,
    )
    if location_id is not None:
        q = q.filter(LocationBoxPlacement.location_id == location_id)
    if lot_id is not None:
        q = q.filter(LocationBoxPlacement.lot_id == lot_id)
    return q.order_by(LocationBoxPlacement.placed_at.asc()).first()


def place_sealed_boxes_for_receipt(
    db: Session,
    *,
    box_barcode: str,
    location_id: UUID,
    lot_id: UUID,
    user: UserModel,
    box_count: int,
    receipt_qty: Decimal,
) -> None:
    """Qabul yakunida: movement qo'shilgandan keyin qutilarni sealed deb belgilash."""
    if box_count < 1:
        raise HTTPException(status_code=400, detail="box_count must be >= 1")
    if box_count > 500:
        raise HTTPException(status_code=400, detail="box_count too large")
    box = _get_product_box_by_barcode(db, box_barcode)
    lot = db.get(StockLotModel, lot_id)
    if not lot or lot.product_id != box.product_id:
        raise HTTPException(status_code=400, detail="Partiya mahsulotga mos emas")
    units_needed = box.units_per_box * box_count
    qty_dec = Decimal(str(receipt_qty))
    if qty_dec != Decimal(str(units_needed)):
        raise HTTPException(
            status_code=400,
            detail=f"qty {int(qty_dec)} != box_count * units_per_box ({units_needed})",
        )
    lock_lot_location(db, lot_id, location_id)
    available = compute_lot_location_available(db, lot_id, location_id)
    if available < Decimal(str(units_needed)):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Qabul qilingan qoldiq yetarli emas (kerak {units_needed}, mavjud {int(available)})"
            ),
        )
    for _ in range(box_count):
        db.add(
            LocationBoxPlacement(
                product_box_id=box.id,
                location_id=location_id,
                lot_id=lot_id,
                status=PLACEMENT_SEALED,
                placed_by_user_id=user.id,
            )
        )
    db.flush()


def place_sealed_boxes(
    db: Session,
    *,
    box_barcode: str,
    location_id: UUID,
    lot_id: UUID,
    user: UserModel,
    box_count: int = 1,
) -> LocationBoxBreakdown:
    if box_count < 1:
        raise HTTPException(status_code=400, detail="box_count must be >= 1")
    if box_count > 500:
        raise HTTPException(status_code=400, detail="box_count too large")
    box = _get_product_box_by_barcode(db, box_barcode)
    lot = db.get(StockLotModel, lot_id)
    if not lot or lot.product_id != box.product_id:
        raise HTTPException(status_code=400, detail="Partiya mahsulotga mos emas")
    lock_lot_location(db, lot_id, location_id)
    breakdown = get_breakdown(
        db,
        product_id=box.product_id,
        lot_id=lot_id,
        location_id=location_id,
    )
    units_needed = box.units_per_box * box_count
    if breakdown.loose_units < units_needed:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Qutisiz qoldiq yetarli emas (kerak {units_needed}, mavjud {breakdown.loose_units})"
            ),
        )
    for _ in range(box_count):
        db.add(
            LocationBoxPlacement(
                product_box_id=box.id,
                location_id=location_id,
                lot_id=lot_id,
                status=PLACEMENT_SEALED,
                placed_by_user_id=user.id,
            )
        )
    db.flush()
    return get_breakdown(
        db,
        product_id=box.product_id,
        lot_id=lot_id,
        location_id=location_id,
    )


def place_sealed_box(
    db: Session,
    *,
    box_barcode: str,
    location_id: UUID,
    lot_id: UUID,
    user: UserModel,
) -> LocationBoxBreakdown:
    return place_sealed_boxes(
        db,
        box_barcode=box_barcode,
        location_id=location_id,
        lot_id=lot_id,
        user=user,
        box_count=1,
    )


def remove_sealed_box(
    db: Session,
    *,
    box_barcode: str,
    user: UserModel,
    reason: str,
    location_id: UUID | None = None,
    lot_id: UUID | None = None,
) -> LocationBoxBreakdown:
    box = _get_product_box_by_barcode(db, box_barcode)
    placement = _find_sealed_at(
        db,
        box.id,
        location_id=location_id,
        lot_id=lot_id,
    )
    if not placement:
        raise HTTPException(status_code=404, detail="Quti bu lokatsiyada joylashmagan")
    placement.status = PLACEMENT_REMOVED
    placement.removed_at = datetime.now(timezone.utc)
    placement.removed_by_user_id = user.id
    placement.remove_reason = reason
    db.flush()
    return get_breakdown(
        db,
        product_id=box.product_id,
        lot_id=placement.lot_id,
        location_id=placement.location_id,
    )


def relocate_sealed_box(
    db: Session,
    *,
    box_barcode: str,
    to_location_id: UUID,
    user: UserModel,
    from_location_id: UUID | None = None,
) -> LocationBoxBreakdown:
    box = _get_product_box_by_barcode(db, box_barcode)
    placement = _find_sealed_at(
        db,
        box.id,
        location_id=from_location_id,
    )
    if not placement:
        raise HTTPException(status_code=404, detail="Quti joylashmagan")
    if placement.location_id == to_location_id:
        return get_breakdown(
            db,
            product_id=box.product_id,
            lot_id=placement.lot_id,
            location_id=to_location_id,
        )
    lock_lot_location(db, placement.lot_id, placement.location_id)
    lock_lot_location(db, placement.lot_id, to_location_id)
    placement.location_id = to_location_id
    db.flush()
    return get_breakdown(
        db,
        product_id=box.product_id,
        lot_id=placement.lot_id,
        location_id=to_location_id,
    )


def remove_box_for_pick_if_needed(
    db: Session,
    *,
    box_barcode: str,
    location_id: UUID,
    lot_id: UUID,
    user: UserModel,
    pick_qty: Decimal,
) -> None:
    """Quti skan bilan terishda sealed yozuvni olib tashlaydi."""
    box = _get_product_box_by_barcode(db, box_barcode)
    if pick_qty != Decimal(str(box.units_per_box)):
        raise HTTPException(
            status_code=400,
            detail=f"Quti skanida miqdor {box.units_per_box} bo'lishi kerak",
        )
    remove_sealed_box(
        db,
        box_barcode=box_barcode,
        user=user,
        reason="pick",
        location_id=location_id,
        lot_id=lot_id,
    )


def require_sufficient_loose_for_unit_pick(
    db: Session,
    *,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
    qty: Decimal,
) -> None:
    if qty <= 0:
        return
    breakdown = get_breakdown(
        db,
        product_id=product_id,
        lot_id=lot_id,
        location_id=location_id,
    )
    if int(qty) > breakdown.loose_units:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Qutisiz qoldiq yetarli emas (kerak {int(qty)}, mavjud {breakdown.loose_units}). "
                "Quti skan qiling."
            ),
        )
