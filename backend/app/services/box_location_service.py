"""Lokatsiyada yopiq quti joylashuvi va qutisiz dona hisobi."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session, joinedload

from app.models.location_box_placement import (
    PLACEMENT_REMOVED,
    PLACEMENT_SEALED,
    LocationBoxPlacement,
)
from app.models.product_box import ProductBox as ProductBoxModel
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.models.user import User as UserModel
from app.services.product_scan_resolve import (
    ProductScanResolve,
    is_explicit_box_pick,
    normalize_scan_barcode,
)
from app.services.stock_availability import (
    PHYSICAL_ON_HAND_MOVEMENT_TYPES,
    compute_lot_location_available,
    compute_lot_location_balances,
    lock_lot_location,
)


@dataclass(frozen=True)
class SealedBoxInfo:
    placement_id: UUID
    product_box_id: UUID
    box_barcode: str
    units_per_box: int
    label: str | None


_BREAKDOWN_INCONSISTENT_DETAIL = (
    "Qutilardagi dona jami qoldiqdan oshib ketgan (ma'lumot nomuvofiqligi)"
)


@dataclass(frozen=True)
class LocationBoxBreakdown:
    product_id: UUID
    lot_id: UUID
    location_id: UUID
    box_count: int
    units_in_boxes: int
    loose_units: int
    total_units: int
    sealed_boxes: list[SealedBoxInfo] = field(default_factory=list)
    data_inconsistent: bool = False


@dataclass(frozen=True)
class ProductBoxSummary:
    box_count: int = 0
    units_in_boxes: int = 0
    loose_units: int = 0


@dataclass(frozen=True)
class HybridPickPlan:
    full_boxes: int
    loose_needed: int
    loose_from_stock: int
    boxes_to_open: int
    total_boxes_consumed: int


def compute_consolidated_box_loose_plan(
    line_remainders: list[int],
    units_per_box: int,
) -> tuple[int, int]:
    """Umumiy yig'ish: har buyurtma qoldig'i bo'yicha quti/dona, keyin yig'indi."""
    if units_per_box < 1:
        loose_total = sum(max(0, int(q)) for q in line_remainders)
        return 0, loose_total
    boxes = 0
    loose = 0
    for q in line_remainders:
        rem = max(0, int(q))
        if rem <= 0:
            continue
        boxes += rem // units_per_box
        loose += rem % units_per_box
    return boxes, loose


def consolidated_remainders_by_document(
    lines: list,
) -> list[int]:
    """Bir hujjatdagi bir nechta qatorlarni yig'ib, har buyurtma uchun qoldiq."""
    by_doc: dict[UUID, int] = {}
    for line in lines:
        if getattr(line, "is_vip_expiry_informational", False):
            continue
        rem = max(
            0,
            int(getattr(line, "qty_required", 0) or 0)
            - int(getattr(line, "qty_picked", 0) or 0),
        )
        if rem <= 0:
            continue
        doc_id = getattr(line, "document_id", None)
        if doc_id is None:
            continue
        by_doc[doc_id] = by_doc.get(doc_id, 0) + rem
    return list(by_doc.values())


def compute_hybrid_pick_plan(
    total: int,
    units_per_box: int,
    available_loose: int = 0,
) -> HybridPickPlan | None:
    """Gibrid terish: to'liq qutilar + qisman dona uchun ochiladigan quti."""
    if units_per_box < 1 or total < 0:
        return None
    total_i = max(0, int(total))
    upb = int(units_per_box)
    avail_loose = max(0, int(available_loose))
    full_boxes = total_i // upb
    loose_needed = total_i % upb
    loose_from_stock = min(loose_needed, avail_loose)
    loose_deficit = loose_needed - loose_from_stock
    boxes_to_open = (loose_deficit + upb - 1) // upb if loose_deficit > 0 else 0
    return HybridPickPlan(
        full_boxes=full_boxes,
        loose_needed=loose_needed,
        loose_from_stock=loose_from_stock,
        boxes_to_open=boxes_to_open,
        total_boxes_consumed=full_boxes + boxes_to_open,
    )


def pair_box_loose_from_available(
    available: int,
    box_count: int,
    units_in_boxes: int,
) -> tuple[int, int, int]:
    """Mobil get_breakdown bilan bir xil: available asosida quti/qutisiz."""
    total = max(0, int(available))
    if units_in_boxes > total:
        return 0, 0, total
    return box_count, units_in_boxes, total - units_in_boxes


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


def units_in_boxes_at(db: Session, lot_id: UUID, location_id: UUID) -> int:
    """Lot/joydagi sealed qutilardagi jami dona (faol qutilar bo'yicha)."""
    _box_count, units_in_boxes, _sealed = _units_in_boxes_for_lot_location(db, lot_id, location_id)
    return units_in_boxes


def box_invariant_holds(db: Session, lot_id: UUID, location_id: UUID) -> bool:
    """Invariant: sealed qutilardagi dona jami fizik qoldiqdan (on_hand) oshmasligi kerak.

    `units_in_boxes <= on_hand`. Buzilsa — sealed chelak "drift" qilgan (oqimlardan biri
    total'ni o'zgartirib, sealed placement'ni mos saqlamagan) degani.
    """
    on_hand, _reserved, _available = compute_lot_location_balances(db, lot_id, location_id)
    _box_count, units_in_boxes, _sealed = _units_in_boxes_for_lot_location(db, lot_id, location_id)
    return units_in_boxes <= max(0, int(on_hand))


def assert_box_invariant(db: Session, lot_id: UUID, location_id: UUID) -> None:
    """Mutatsiyadan keyin chaqiriladigan himoya: invariant buzilsa 409.

    Stock+quti o'zgartirgan oqimlar oxirida chaqirib, sealed chelak total bilan
    moslshini kafolatlaydi. Buzilsa tranzaksiya rollback bo'lishi kerak.
    """
    if not box_invariant_holds(db, lot_id, location_id):
        _bc, units_in_boxes, _ = _units_in_boxes_for_lot_location(db, lot_id, location_id)
        on_hand, _r, _a = compute_lot_location_balances(db, lot_id, location_id)
        raise HTTPException(
            status_code=409,
            detail=(
                f"Quti invariant buzildi: qutilardagi dona ({units_in_boxes}) "
                f"fizik qoldiqdan ({int(on_hand)}) oshib ketdi"
            ),
        )


def get_breakdown_with_mode(
    db: Session,
    *,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
    strict: bool = True,
) -> LocationBoxBreakdown:
    lot = db.get(StockLotModel, lot_id)
    if not lot or lot.product_id != product_id:
        raise HTTPException(status_code=400, detail="Invalid lot for product")
    available = compute_lot_location_available(db, lot_id, location_id)
    box_count, units_in_boxes, sealed = _units_in_boxes_for_lot_location(db, lot_id, location_id)
    total = max(0, int(available))
    inconsistent = units_in_boxes > total
    if inconsistent and strict:
        raise HTTPException(status_code=409, detail=_BREAKDOWN_INCONSISTENT_DETAIL)
    bc, uib, loose = pair_box_loose_from_available(total, box_count, units_in_boxes)
    return LocationBoxBreakdown(
        product_id=product_id,
        lot_id=lot_id,
        location_id=location_id,
        box_count=bc,
        units_in_boxes=uib,
        loose_units=loose,
        total_units=total,
        sealed_boxes=sealed,
        data_inconsistent=inconsistent,
    )


def get_breakdown(
    db: Session,
    *,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
) -> LocationBoxBreakdown:
    return get_breakdown_with_mode(
        db,
        product_id=product_id,
        lot_id=lot_id,
        location_id=location_id,
        strict=True,
    )


def get_breakdown_tolerant(
    db: Session,
    *,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
) -> LocationBoxBreakdown:
    return get_breakdown_with_mode(
        db,
        product_id=product_id,
        lot_id=lot_id,
        location_id=location_id,
        strict=False,
    )


def breakdown_kwargs_for_pick(
    on_hand: int,
    available: int,
    sealed_box_count: int,
    sealed_units_in_boxes: int,
) -> dict[str, int]:
    """Terish API/UI: on_hand asosida quti/qutisiz (reserved zaxira bilan ham)."""
    total_oh = max(0, int(on_hand))
    total_av = max(0, int(available))
    bc, uib, loose_oh = pair_box_loose_from_available(
        total_oh, sealed_box_count, sealed_units_in_boxes
    )
    if sealed_units_in_boxes > total_av:
        _, _, loose_av = pair_box_loose_from_available(
            total_av, sealed_box_count, sealed_units_in_boxes
        )
        loose = max(loose_oh, loose_av)
    else:
        loose = loose_oh
    return {
        "box_count": bc,
        "units_in_boxes": uib,
        "loose_units": loose,
    }


def get_breakdown_for_pick(
    db: Session,
    *,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
) -> LocationBoxBreakdown:
    """Terish UI: ajratilgan (reserved) zaxira bilan ham quti sonini ko'rsatish."""
    from app.services.stock_availability import compute_lot_location_balances

    lot = db.get(StockLotModel, lot_id)
    if not lot or lot.product_id != product_id:
        raise HTTPException(status_code=400, detail="Invalid lot for product")
    on_hand, _reserved, available = compute_lot_location_balances(db, lot_id, location_id)
    total_oh = max(0, int(on_hand))
    total_av = max(0, int(available))
    box_count, units_in_boxes, sealed = _units_in_boxes_for_lot_location(db, lot_id, location_id)
    bd_kw = breakdown_kwargs_for_pick(total_oh, total_av, box_count, units_in_boxes)
    inconsistent = units_in_boxes > total_oh or units_in_boxes > total_av
    return LocationBoxBreakdown(
        product_id=product_id,
        lot_id=lot_id,
        location_id=location_id,
        box_count=bd_kw["box_count"],
        units_in_boxes=bd_kw["units_in_boxes"],
        loose_units=bd_kw["loose_units"],
        total_units=total_oh,
        sealed_boxes=sealed,
        data_inconsistent=inconsistent,
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
        out[key] = get_breakdown_tolerant(
            db,
            product_id=product_id,
            lot_id=lot_id,
            location_id=location_id,
        )
    return out


def product_box_summary_map(
    db: Session,
    product_ids: list[UUID],
    location_ids: list[UUID] | None = None,
) -> dict[UUID, ProductBoxSummary]:
    """Mahsulot bo'yicha quti/qutisiz dona yig'indisi (batch, N+1 siz)."""
    if not product_ids:
        return {}

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

    balance_q = (
        db.query(
            StockLotModel.product_id,
            StockMovementModel.lot_id,
            StockMovementModel.location_id,
            available_expr.label("available"),
        )
        .join(StockLotModel, StockLotModel.id == StockMovementModel.lot_id)
        .filter(StockLotModel.product_id.in_(product_ids))
    )
    if location_ids is not None:
        balance_q = balance_q.filter(StockMovementModel.location_id.in_(location_ids))
    balance_rows = (
        balance_q.group_by(
            StockLotModel.product_id,
            StockMovementModel.lot_id,
            StockMovementModel.location_id,
        )
        .having(available_expr != 0)
        .all()
    )

    pairs: set[tuple[UUID, UUID]] = set()
    balances: dict[tuple[UUID, UUID], int] = {}
    product_by_pair: dict[tuple[UUID, UUID], UUID] = {}
    for row in balance_rows:
        key = (row.lot_id, row.location_id)
        pairs.add(key)
        balances[key] = int(row.available or 0)
        product_by_pair[key] = row.product_id

    boxes: dict[tuple[UUID, UUID], tuple[int, int]] = {}
    if pairs:
        lot_ids = {p[0] for p in pairs}
        loc_ids = {p[1] for p in pairs}
        box_rows = (
            db.query(
                LocationBoxPlacement.lot_id,
                LocationBoxPlacement.location_id,
                func.count(LocationBoxPlacement.id).label("box_count"),
                func.coalesce(func.sum(ProductBoxModel.units_per_box), 0).label("units"),
            )
            .join(ProductBoxModel, ProductBoxModel.id == LocationBoxPlacement.product_box_id)
            .filter(
                LocationBoxPlacement.lot_id.in_(lot_ids),
                LocationBoxPlacement.location_id.in_(loc_ids),
                LocationBoxPlacement.status == PLACEMENT_SEALED,
                ProductBoxModel.is_active.is_(True),
            )
            .group_by(LocationBoxPlacement.lot_id, LocationBoxPlacement.location_id)
            .all()
        )
        boxes = {
            (r.lot_id, r.location_id): (int(r.box_count), int(r.units)) for r in box_rows
        }

    out: dict[UUID, ProductBoxSummary] = {pid: ProductBoxSummary() for pid in product_ids}
    for key, available in balances.items():
        product_id = product_by_pair[key]
        box_count, units_in_boxes = boxes.get(key, (0, 0))
        bc, uib, loose = pair_box_loose_from_available(available, box_count, units_in_boxes)
        prev = out[product_id]
        out[product_id] = ProductBoxSummary(
            box_count=prev.box_count + bc,
            units_in_boxes=prev.units_in_boxes + uib,
            loose_units=prev.loose_units + loose,
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
    if qty_dec < Decimal(str(units_needed)):
        raise HTTPException(
            status_code=400,
            detail=f"qty {int(qty_dec)} < box_count * units_per_box ({units_needed})",
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
    breakdown = get_breakdown_tolerant(
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
    return get_breakdown_tolerant(
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
    return get_breakdown_tolerant(
        db,
        product_id=box.product_id,
        lot_id=placement.lot_id,
        location_id=placement.location_id,
    )


def remove_all_sealed_at(
    db: Session,
    *,
    lot_id: UUID,
    location_id: UUID,
    user: UserModel,
    reason: str,
) -> int:
    """Lot/joydagi barcha SEALED quti joylashuvini 'removed' holatiga o'tkazadi.

    Qaytaradi: o'chirilgan quti soni. Stock (total)ni O'ZGARTIRMAYDI — chaqiruvchi
    qoldiqni allaqachon to'g'rilagan bo'lishi kerak (masalan zero-stock adjust'i).
    Qoldiq nolga tushirilganda quti yozuvlari qolib fantom (invariant buzilishi)
    bo'lmasligi uchun ishlatiladi.
    """
    placements = (
        db.query(LocationBoxPlacement)
        .filter(
            LocationBoxPlacement.lot_id == lot_id,
            LocationBoxPlacement.location_id == location_id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
        )
        .all()
    )
    if not placements:
        return 0
    now = datetime.now(timezone.utc)
    for p in placements:
        p.status = PLACEMENT_REMOVED
        p.removed_at = now
        p.removed_by_user_id = user.id
        p.remove_reason = reason
    db.flush()
    return len(placements)


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
        return get_breakdown_tolerant(
            db,
            product_id=box.product_id,
            lot_id=placement.lot_id,
            location_id=to_location_id,
        )
    from_location_id_actual = placement.location_id
    lot_id = placement.lot_id
    lock_lot_location(db, lot_id, from_location_id_actual)
    lock_lot_location(db, lot_id, to_location_id)
    # Q4: quti butun ko'chadi (ochilmaydi) — placement bilan birga fizik qoldiq ham ko'chadi.
    upb = Decimal(str(box.units_per_box))
    db.add(
        StockMovementModel(
            product_id=box.product_id,
            lot_id=lot_id,
            location_id=from_location_id_actual,
            qty_change=-upb,
            movement_type="transfer_out",
            created_by_user_id=user.id,
        )
    )
    db.add(
        StockMovementModel(
            product_id=box.product_id,
            lot_id=lot_id,
            location_id=to_location_id,
            qty_change=upb,
            movement_type="transfer_in",
            created_by_user_id=user.id,
        )
    )
    placement.location_id = to_location_id
    db.flush()
    assert_box_invariant(db, lot_id, from_location_id_actual)
    assert_box_invariant(db, lot_id, to_location_id)
    return get_breakdown_tolerant(
        db,
        product_id=box.product_id,
        lot_id=lot_id,
        location_id=to_location_id,
    )


def reconcile_count(
    db: Session,
    *,
    box_barcode: str,
    location_id: UUID,
    lot_id: UUID,
    user: UserModel,
    box_count: int,
    loose_units: int,
) -> LocationBoxBreakdown:
    """Inventarizatsiya sanog'i: yopiq quti soni va qutisiz donani aniq belgilaydi.

    Q3: sanoqchi "nechta yopiq quti + nechta dona" kiritadi. Funksiya:
      - fizik qoldiqni target = box_count*upb + loose_units ga keltiradi (adjust),
      - shu quti turining sealed placement'larini box_count ga moslaydi,
      - invariantni tekshiradi.
    Bu ikkala chelakni (total va sealed) birga to'g'rilab, drift'ni yo'qotadi.

    Eslatma: bitta quti turi (box_barcode) bo'yicha ishlaydi. Bir lot/joyda boshqa
    tur sealed qutilar bo'lsa, ular alohida sanalishi kerak.
    """
    if box_count < 0:
        raise HTTPException(status_code=400, detail="box_count manfiy bo'lmasligi kerak")
    if box_count > 500:
        raise HTTPException(status_code=400, detail="box_count juda katta")
    if loose_units < 0:
        raise HTTPException(status_code=400, detail="loose_units manfiy bo'lmasligi kerak")
    box = _get_product_box_by_barcode(db, box_barcode)
    lot = db.get(StockLotModel, lot_id)
    if not lot or lot.product_id != box.product_id:
        raise HTTPException(status_code=400, detail="Partiya mahsulotga mos emas")
    upb = int(box.units_per_box)
    if upb < 1:
        raise HTTPException(status_code=400, detail="Quti ichidagi dona soni noto'g'ri")

    lock_lot_location(db, lot_id, location_id)

    # 1) Fizik qoldiqni target jamiga keltirish.
    target_total = Decimal(str(box_count * upb + int(loose_units)))
    on_hand, reserved, _available = compute_lot_location_balances(db, lot_id, location_id)
    delta = target_total - Decimal(str(on_hand))
    # Rezerv-himoya: sanoqni kamaytirish rezervlangan (buyurtmaga ajratilgan)
    # qoldiqdan past tushirmasligi kerak — aks holda available manfiy bo'lib,
    # rezerv hisobi buziladi. Manual adjust yo'li (require_sufficient_available)
    # bilan izchil.
    if delta < 0 and target_total < reserved:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Rezervlangan {int(reserved)} dona bor — sanoqni {int(target_total)} donaga "
                "tushirib bo'lmaydi. Avval buyurtma yig'ishni yakunlang yoki rezervni bo'shating."
            ),
        )
    if delta != 0:
        db.add(
            StockMovementModel(
                product_id=box.product_id,
                lot_id=lot_id,
                location_id=location_id,
                qty_change=delta,
                movement_type="adjust",
                reason_code="inventory_overage" if delta > 0 else "inventory_shortage",
                created_by_user_id=user.id,
            )
        )

    # 2) Shu quti turining sealed soni = box_count bo'lsin.
    current_sealed = (
        db.query(LocationBoxPlacement)
        .filter(
            LocationBoxPlacement.product_box_id == box.id,
            LocationBoxPlacement.lot_id == lot_id,
            LocationBoxPlacement.location_id == location_id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
        )
        .order_by(LocationBoxPlacement.placed_at.asc())
        .all()
    )
    diff = box_count - len(current_sealed)
    if diff > 0:
        for _ in range(diff):
            db.add(
                LocationBoxPlacement(
                    product_box_id=box.id,
                    location_id=location_id,
                    lot_id=lot_id,
                    status=PLACEMENT_SEALED,
                    placed_by_user_id=user.id,
                )
            )
    elif diff < 0:
        for placement in current_sealed[: -diff]:
            placement.status = PLACEMENT_REMOVED
            placement.removed_at = datetime.now(timezone.utc)
            placement.removed_by_user_id = user.id
            placement.remove_reason = "count"
    db.flush()
    assert_box_invariant(db, lot_id, location_id)
    return get_breakdown_tolerant(
        db,
        product_id=box.product_id,
        lot_id=lot_id,
        location_id=location_id,
    )


def _assert_enough_sealed_for_pick(
    db: Session,
    *,
    box: ProductBoxModel,
    lot_id: UUID,
    location_id: UUID,
    box_count: int,
) -> None:
    """Skanerlangan kod bo'yicha yetarli yopiq quti bormi.

    Sanoq shtrix-kodga bog'liq, ekrandagi quti soni esa emas — u joydagi hamma
    qutini ko'rsatadi. Shu sababli "kerak 2, mavjud 0" xabari operatorni
    chalkashtiradi: ekranda qutilar ko'rinib turadi. Agar joyda boshqa kod
    ostida yozilgan qutilar bo'lsa, aynan shu aytiladi.
    """
    sealed_count = (
        db.query(LocationBoxPlacement)
        .filter(
            LocationBoxPlacement.product_box_id == box.id,
            LocationBoxPlacement.lot_id == lot_id,
            LocationBoxPlacement.location_id == location_id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
        )
        .count()
    )
    if sealed_count >= box_count:
        return

    _total, _units, sealed = _units_in_boxes_for_lot_location(db, lot_id, location_id)
    other_codes = sorted(
        {
            info.box_barcode
            for info in sealed
            if info.product_box_id != box.id and info.box_barcode
        }
    )
    if other_codes:
        raise HTTPException(
            status_code=409,
            detail=(
                "Bu joydagi qutilar boshqa shtrix-kod ostida yozilgan: "
                + ", ".join(other_codes)
            ),
        )
    raise HTTPException(
        status_code=409,
        detail=f"Sealed quti yetarli emas (kerak {box_count}, mavjud {sealed_count})",
    )


def remove_sealed_boxes_for_pick(
    db: Session,
    *,
    box_barcode: str,
    location_id: UUID,
    lot_id: UUID,
    user: UserModel,
    box_count: int,
    pick_qty: Decimal,
    source_document_id: UUID | None = None,
) -> None:
    """Terishda bir yoki bir nechta sealed qutini olib tashlaydi (butun quti terish)."""
    if box_count < 1:
        raise HTTPException(status_code=400, detail="box_count must be >= 1")
    if box_count > 500:
        raise HTTPException(status_code=400, detail="box_count too large")
    box = _get_product_box_by_barcode(db, box_barcode)
    lot = db.get(StockLotModel, lot_id)
    if not lot or lot.product_id != box.product_id:
        raise HTTPException(status_code=400, detail="Partiya mahsulotga mos emas")
    expected = Decimal(str(box.units_per_box * box_count))
    qty_dec = Decimal(str(pick_qty))
    if qty_dec != expected:
        raise HTTPException(
            status_code=400,
            detail=f"qty {int(qty_dec)} != box_count * units_per_box ({int(expected)})",
        )
    lock_lot_location(db, lot_id, location_id)
    _assert_enough_sealed_for_pick(
        db, box=box, lot_id=lot_id, location_id=location_id, box_count=box_count
    )
    for _ in range(box_count):
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
        placement.remove_reason = "pick"
        placement.source_document_id = source_document_id
        db.flush()


def open_sealed_boxes_for_pick(
    db: Session,
    *,
    box_barcode: str,
    location_id: UUID,
    lot_id: UUID,
    user: UserModel,
    box_count: int,
    source_document_id: UUID | None = None,
) -> None:
    """Terishda qisman dona uchun sealed qutini ochish (ichidagi donalar ochiq qoldiqka o'tadi)."""
    if box_count < 1:
        raise HTTPException(status_code=400, detail="box_count must be >= 1")
    if box_count > 500:
        raise HTTPException(status_code=400, detail="box_count too large")
    box = _get_product_box_by_barcode(db, box_barcode)
    lot = db.get(StockLotModel, lot_id)
    if not lot or lot.product_id != box.product_id:
        raise HTTPException(status_code=400, detail="Partiya mahsulotga mos emas")
    lock_lot_location(db, lot_id, location_id)
    _assert_enough_sealed_for_pick(
        db, box=box, lot_id=lot_id, location_id=location_id, box_count=box_count
    )
    for _ in range(box_count):
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
        placement.remove_reason = "pick_open"
        placement.source_document_id = source_document_id
        db.flush()


def restore_sealed_boxes_for_unpick(
    db: Session,
    *,
    lot_id: UUID,
    location_id: UUID,
    source_document_id: UUID,
    returned_qty: Decimal,
) -> int:
    """Unpick/skip/cancel'da butun-quti pick (reason='pick') yozuvlarini qaytaradi.

    Qutilar almashtiriladigani (fungible) uchun aynan qaysi quti emas, *soni* muhim:
    qaytarilgan miqdor nechta to'liq qutini qoplasa, shuncha sealed yozuv tiklanadi
    (eng oxirgi olinganidan boshlab — LIFO). Ochilgan qutilar (reason='pick_open')
    qaytarilmaydi — fizik qayta yopib bo'lmaydi.

    Returns: tiklangan qutilar soni.
    """
    qty = int(max(0, int(returned_qty)))
    if qty <= 0:
        return 0
    removed = (
        db.query(LocationBoxPlacement)
        .options(joinedload(LocationBoxPlacement.product_box))
        .filter(
            LocationBoxPlacement.lot_id == lot_id,
            LocationBoxPlacement.location_id == location_id,
            LocationBoxPlacement.status == PLACEMENT_REMOVED,
            LocationBoxPlacement.remove_reason == "pick",
            LocationBoxPlacement.source_document_id == source_document_id,
        )
        .order_by(LocationBoxPlacement.removed_at.desc())
        .all()
    )
    restored = 0
    for placement in removed:
        box = placement.product_box
        if not box or not box.is_active:
            continue
        upb = int(box.units_per_box or 0)
        if upb < 1 or qty < upb:
            continue
        placement.status = PLACEMENT_SEALED
        placement.removed_at = None
        placement.removed_by_user_id = None
        placement.remove_reason = None
        placement.source_document_id = None
        qty -= upb
        restored += 1
        db.flush()
    return restored


def validate_hybrid_pick_qty(
    db: Session,
    *,
    product_id: UUID,
    box_barcode: str | None,
    box_count: int | None,
    total_qty: Decimal,
) -> tuple[Decimal, Decimal]:
    """Gibrid terish: jami miqdordan quti va qutisiz qismlarni ajratadi."""
    has_barcode = box_barcode is not None and box_barcode.strip() != ""
    has_count = box_count is not None
    if has_barcode != has_count:
        raise HTTPException(
            status_code=400,
            detail="box_barcode va box_count birgalikda berilishi kerak",
        )
    if not has_barcode:
        return Decimal("0"), total_qty
    assert box_count is not None
    if box_count < 1:
        raise HTTPException(status_code=400, detail="box_count must be >= 1")
    box = _get_product_box_by_barcode(db, box_barcode)
    if box.product_id != product_id:
        raise HTTPException(status_code=400, detail="Quti mahsulotga mos emas")
    box_units = Decimal(str(box.units_per_box * box_count))
    qty_dec = Decimal(str(total_qty))
    if qty_dec < box_units:
        plan = compute_hybrid_pick_plan(
            int(qty_dec),
            box.units_per_box,
            available_loose=0,
        )
        if (
            plan is not None
            and plan.full_boxes == 0
            and plan.boxes_to_open > 0
        ):
            return Decimal("0"), qty_dec
        raise HTTPException(
            status_code=400,
            detail=f"qty {int(qty_dec)} < box_count * units_per_box ({int(box_units)})",
        )
    return box_units, qty_dec - box_units


def apply_hybrid_pick_side_effects(
    db: Session,
    *,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
    user: UserModel,
    box_barcode: str,
    box_count: int,
    box_units: Decimal,
    loose_units: Decimal,
    source_document_id: UUID | None = None,
) -> None:
    """Gibrid terish: to'liq quti, kerak bo'lsa quti ochish, qutisiz dona tekshiruvi."""
    boxes_to_open = 0
    if loose_units > 0:
        from app.services.stock_availability import compute_lot_location_balances

        on_hand, _reserved, _available = compute_lot_location_balances(
            db, lot_id, location_id
        )
        box_count_pl, units_in_boxes, _ = _units_in_boxes_for_lot_location(
            db, lot_id, location_id
        )
        _bc, _uib, loose_on_hand = pair_box_loose_from_available(
            max(0, int(on_hand)), box_count_pl, units_in_boxes
        )
        loose_int = int(loose_units)
        deficit = loose_int - loose_on_hand
        if deficit > 0:
            box = _get_product_box_by_barcode(db, box_barcode)
            upb = box.units_per_box
            if upb < 1:
                raise HTTPException(status_code=400, detail="Invalid units_per_box")
            boxes_to_open = (deficit + upb - 1) // upb
    if box_count > 0 and box_units > 0:
        remove_sealed_boxes_for_pick(
            db,
            box_barcode=box_barcode,
            location_id=location_id,
            lot_id=lot_id,
            user=user,
            box_count=box_count,
            pick_qty=box_units,
            source_document_id=source_document_id,
        )
    if boxes_to_open > 0:
        open_sealed_boxes_for_pick(
            db,
            box_barcode=box_barcode,
            location_id=location_id,
            lot_id=lot_id,
            user=user,
            box_count=boxes_to_open,
            source_document_id=source_document_id,
        )
    if loose_units > 0:
        require_sufficient_loose_for_unit_pick(
            db,
            product_id=product_id,
            lot_id=lot_id,
            location_id=location_id,
            qty=loose_units,
        )


def apply_scan_pick_side_effects(
    db: Session,
    *,
    resolved: ProductScanResolve | None,
    box_count: int | None,
    qty_delta: Decimal,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
    user: UserModel,
    scan_barcode: str,
    source_document_id: UUID | None = None,
) -> None:
    """Skan asosida quti yoki qutisiz terish side-effectlari (pick_line, consolidated, waves)."""
    if qty_delta <= 0:
        return
    if is_explicit_box_pick(resolved, box_count):
        remove_sealed_boxes_for_pick(
            db,
            box_barcode=scan_barcode,
            location_id=location_id,
            lot_id=lot_id,
            user=user,
            box_count=int(box_count),
            pick_qty=qty_delta,
            source_document_id=source_document_id,
        )
        return
    if not resolved:
        return
    if resolved.scan_kind == "box":
        breakdown = get_breakdown_for_pick(
            db,
            product_id=product_id,
            lot_id=lot_id,
            location_id=location_id,
        )
        qty_int = int(qty_delta)
        if qty_int <= breakdown.loose_units:
            require_sufficient_loose_for_unit_pick(
                db,
                product_id=product_id,
                lot_id=lot_id,
                location_id=location_id,
                qty=qty_delta,
            )
            return
        upb = resolved.units_per_scan
        if upb >= 1 and qty_int % upb == 0:
            boxes = qty_int // upb
            if breakdown.box_count >= boxes:
                remove_sealed_boxes_for_pick(
                    db,
                    box_barcode=scan_barcode,
                    location_id=location_id,
                    lot_id=lot_id,
                    user=user,
                    box_count=boxes,
                    pick_qty=qty_delta,
                    source_document_id=source_document_id,
                )
                return
        raise HTTPException(status_code=400, detail="box_count required for box scan")
    _apply_unit_scan_pick_side_effects(
        db,
        product_id=product_id,
        lot_id=lot_id,
        location_id=location_id,
        user=user,
        qty_delta=qty_delta,
        source_document_id=source_document_id,
    )


def _active_product_box(db: Session, product_id: UUID) -> ProductBoxModel | None:
    return (
        db.query(ProductBoxModel)
        .filter(
            ProductBoxModel.product_id == product_id,
            ProductBoxModel.is_active.is_(True),
        )
        .order_by(ProductBoxModel.id)
        .first()
    )


def _apply_unit_scan_pick_side_effects(
    db: Session,
    *,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
    user: UserModel,
    qty_delta: Decimal,
    source_document_id: UUID | None = None,
) -> None:
    """Dona skan: qutisiz yetmasa, faqat qutida zaxiradan avto quti yoki box_count talab."""
    breakdown = get_breakdown_for_pick(
        db,
        product_id=product_id,
        lot_id=lot_id,
        location_id=location_id,
    )
    qty_int = int(qty_delta)
    if qty_int <= breakdown.loose_units:
        require_sufficient_loose_for_unit_pick(
            db,
            product_id=product_id,
            lot_id=lot_id,
            location_id=location_id,
            qty=qty_delta,
        )
        return
    if breakdown.box_count > 0:
        box = _active_product_box(db, product_id)
        if box:
            upb = box.units_per_box
            if upb >= 1 and qty_int % upb == 0:
                boxes = qty_int // upb
                if breakdown.box_count >= boxes:
                    remove_sealed_boxes_for_pick(
                        db,
                        box_barcode=box.box_barcode,
                        location_id=location_id,
                        lot_id=lot_id,
                        user=user,
                        box_count=boxes,
                        pick_qty=qty_delta,
                        source_document_id=source_document_id,
                    )
                    return
        raise HTTPException(status_code=400, detail="box_count required for box scan")
    require_sufficient_loose_for_unit_pick(
        db,
        product_id=product_id,
        lot_id=lot_id,
        location_id=location_id,
        qty=qty_delta,
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
    # Terish reserved zaxiradan — available=0 bo'lishi mumkin; fizik qutisiz qoldiq on_hand asosida.
    breakdown = get_breakdown_for_pick(
        db,
        product_id=product_id,
        lot_id=lot_id,
        location_id=location_id,
    )
    if int(qty) > breakdown.loose_units:
        if breakdown.loose_units == 0 and breakdown.box_count > 0:
            raise HTTPException(status_code=400, detail="box_count required for box scan")
        raise HTTPException(
            status_code=409,
            detail=(
                f"Qutisiz qoldiq yetarli emas (kerak {int(qty)}, mavjud {breakdown.loose_units}). "
                "Quti skan qiling."
            ),
        )


@dataclass(frozen=True)
class BoxTypeMergeResult:
    """Noto'g'ri shtrix-kodli qutilarni to'g'ri turga o'tkazish natijasi."""

    breakdown: LocationBoxBreakdown
    moved: int
    #: Manba turida boshqa joy/partiyalarda qolgan yopiq qutilar.
    remaining_elsewhere: int


def merge_box_type_at_location(
    db: Session,
    *,
    from_box_barcode: str,
    to_box_barcode: str,
    location_id: UUID,
    lot_id: UUID,
) -> BoxTypeMergeResult:
    """Joydagi qutilarni bir quti turidan boshqasiga o'tkazadi.

    Noto'g'ri shtrix-kod bilan qayd etilgan qutilarni tuzatish uchun. Faqat
    joylashuv yozuvining quti turi almashadi — fizik qoldiq (stock_movements)
    va joylashuv soni tegilmaydi, ya'ni bu qayta yorliqlash, sanoq emas.

    Shu sababli qutidagi dona soni ikkala turda bir xil bo'lishi **shart**:
    aks holda `units_in_boxes` jimgina o'zgarib, quti invariantini buzardi.

    Amal faqat berilgan joy va partiya bilan cheklanadi — bir xil xato boshqa
    joyda ham bo'lsa, u yerda alohida tuzatiladi. Natijadagi
    `remaining_elsewhere` shuni bildiradi.
    """
    from_box = _get_product_box_by_barcode(db, from_box_barcode)
    to_box = _get_product_box_by_barcode(db, to_box_barcode)

    if from_box.id == to_box.id:
        raise HTTPException(
            status_code=400, detail="Manba va manzil quti turi bir xil"
        )
    if from_box.product_id != to_box.product_id:
        raise HTTPException(
            status_code=400, detail="Qutilar har xil mahsulotga tegishli"
        )
    if from_box.units_per_box != to_box.units_per_box:
        raise HTTPException(
            status_code=400,
            detail=(
                "Qutidagi dona soni farq qiladi "
                f"({from_box.units_per_box} va {to_box.units_per_box}) — "
                "birlashtirib bo'lmaydi, avval sanoq qiling"
            ),
        )

    lock_lot_location(db, lot_id, location_id)
    placements = (
        db.query(LocationBoxPlacement)
        .filter(
            LocationBoxPlacement.product_box_id == from_box.id,
            LocationBoxPlacement.location_id == location_id,
            LocationBoxPlacement.lot_id == lot_id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
        )
        .all()
    )
    if not placements:
        raise HTTPException(
            status_code=404, detail="Bu joyda shu shtrix-kodli yopiq quti yo'q"
        )

    for placement in placements:
        # FK emas, bog'lanishning o'zi beriladi: aks holda `product_box`
        # obyekti keshda eski turib qoladi va qaytgan breakdown hamon noto'g'ri
        # shtrix-kodni ko'rsatadi.
        placement.product_box = to_box
    db.flush()

    remaining_elsewhere = (
        db.query(func.count(LocationBoxPlacement.id))
        .filter(
            LocationBoxPlacement.product_box_id == from_box.id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
        )
        .scalar()
        or 0
    )

    # Dona soni o'zgarmagani uchun invariant buzilmasligi kerak; baribir
    # tekshiramiz — bu tuzatish amali, jimgina buzilish qolib ketmasin.
    assert_box_invariant(db, lot_id, location_id)

    return BoxTypeMergeResult(
        breakdown=get_breakdown_tolerant(
            db,
            product_id=to_box.product_id,
            lot_id=lot_id,
            location_id=location_id,
        ),
        moved=len(placements),
        remaining_elsewhere=int(remaining_elsewhere),
    )
