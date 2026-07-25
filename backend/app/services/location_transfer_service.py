"""Joydan joyga zaxira ko'chirish — bitta joy juftligi uchun umumiy mantiq.

Bitta joy (palet) ko'chirish ham, butun sektor ko'chirish ham shu funksiyani
ishlatadi. Harakat yozuvlari, yopiq quti placement'lari, audit log va invariant
tekshiruvlari bitta joyda turishi shart: mantiq nusxalansa, ikki oqim vaqt o'tib
bir-biridan uzoqlashadi, quti/rezerv qismi esa juda nozik.

Funksiya **commit qilmaydi va rollback qilmaydi** — tranzaksiyani chaqiruvchi
boshqaradi. Sektor ko'chirishda o'nlab joy juftligi bitta tranzaksiyada bajariladi
("hammasi yoki hech narsa"), shuning uchun oxirgi tekshiruvlar uchun kerakli
juftliklar natijada qaytariladi.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Optional, Sequence
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.api.v1.endpoints.picker_inventory import _get_lot_level_balances
from app.core.stock_rules import check_location_single_expiry
from app.models.location_box_placement import (
    PLACEMENT_SEALED,
    LocationBoxPlacement as LocationBoxPlacementModel,
)
from app.models.product_box import ProductBox as ProductBoxModel
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.services.audit_service import ACTION_CREATE, log_action
from app.services.box_location_service import assert_box_invariant, get_breakdown_tolerant
from app.services.stock_availability import (
    compute_lot_location_balances,
    lock_lot_location,
    require_sufficient_available,
)


@dataclass
class LocationTransferResult:
    """Bitta yoki bir nechta joy juftligi ko'chirilgandan keyingi yakun."""

    lines_transferred: int = 0
    movements_created: int = 0
    lines_requested: int = 0
    boxes_transferred: int = 0
    #: (lot_id, location_id) — manfiy qoldiq tekshiruvi uchun.
    balance_pairs: set[tuple[UUID, UUID]] = field(default_factory=set)
    #: (lot_id, location_id) — quti invarianti tekshiruvi uchun.
    invariant_pairs: set[tuple[UUID, UUID]] = field(default_factory=set)

    def merge(self, other: "LocationTransferResult") -> None:
        self.lines_transferred += other.lines_transferred
        self.movements_created += other.movements_created
        self.lines_requested += other.lines_requested
        self.boxes_transferred += other.boxes_transferred
        self.balance_pairs |= other.balance_pairs
        self.invariant_pairs |= other.invariant_pairs


def reserved_by_location(
    db: Session, location_ids: Sequence[UUID]
) -> dict[UUID, Decimal]:
    """Joylardagi rezervdagi (terish uchun band) jami dona: {location_id: reserved}.

    Sektor ko'chirishda kerak: butun sektor fizik ko'chganda rezerv eski joyda
    qolib ketmasligi uchun oldindan bloklanadi.

    `_get_lot_level_balances` bu yerda yaramaydi — u `available != 0` shartiga ega,
    ya'ni to'liq rezervdagi lot (on_hand == reserved) natijaga umuman tushmaydi.
    """
    if not location_ids:
        return {}
    reserved_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(("allocate", "unallocate")),
                StockMovementModel.qty_change,
            ),
            else_=0,
        )
    )
    rows = (
        db.query(StockMovementModel.location_id, reserved_expr.label("reserved"))
        .filter(StockMovementModel.location_id.in_(list(location_ids)))
        .group_by(StockMovementModel.location_id)
        .having(reserved_expr > 0)
        .all()
    )
    return {r.location_id: Decimal(str(r.reserved)) for r in rows}


def _collect_transfer_rows(
    db: Session,
    *,
    from_location_id: UUID,
    mode: str,
    lines: Sequence[Any],
    rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    """Ko'chiriladigan (product, lot, qty) qatorlarini yig'adi.

    Q4: dona ko'chirish faqat qutisiz (loose) zaxiradan — qutidagi donalar quti
    sifatida yopiq ko'chiriladi.
    """
    rows_by_lot = {r["lot_id"]: r for r in rows}
    transfer_rows: list[dict[str, Any]] = []
    lines_requested = 0

    if mode == "partial":
        if not lines:
            raise HTTPException(status_code=400, detail="Transfer lines are required for partial mode")
        lines_requested = len(lines)
        for line in lines:
            r = rows_by_lot.get(line.lot_id)
            if r is None:
                raise HTTPException(
                    status_code=400, detail=f"Lot not available at source location: {line.lot_id}"
                )
            if r["product_id"] != line.product_id:
                raise HTTPException(status_code=400, detail=f"Product/lot mismatch: {line.lot_id}")
            available_qty = Decimal(str(r["available"]))
            if line.qty > available_qty:
                raise HTTPException(
                    status_code=400,
                    detail=f"Requested qty exceeds available for lot {line.lot_id}",
                )
            loose_at_src = get_breakdown_tolerant(
                db,
                product_id=r["product_id"],
                lot_id=r["lot_id"],
                location_id=from_location_id,
            ).loose_units
            if line.qty > Decimal(loose_at_src):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Qutidagi zaxirani dona qilib ko'chirib bo'lmaydi "
                        f"(qutisiz mavjud {loose_at_src}). Avval qutini ko'chiring yoki oching."
                    ),
                )
            transfer_rows.append(
                {"product_id": r["product_id"], "lot_id": r["lot_id"], "qty": line.qty}
            )
        return transfer_rows, lines_requested

    # full: ommaviy ko'chirishda ham faqat qutisiz qism dona sifatida ko'chadi;
    # yopiq qutilar quyida placement bilan birga ko'chiriladi.
    for r in rows:
        loose_at_src = get_breakdown_tolerant(
            db,
            product_id=r["product_id"],
            lot_id=r["lot_id"],
            location_id=from_location_id,
        ).loose_units
        qty_loose = min(Decimal(str(r["available"])), Decimal(loose_at_src))
        if qty_loose > 0:
            transfer_rows.append(
                {"product_id": r["product_id"], "lot_id": r["lot_id"], "qty": qty_loose}
            )
    return transfer_rows, lines_requested


def transfer_location_contents(
    db: Session,
    *,
    from_location_id: UUID,
    to_location_id: UUID,
    user_id: UUID,
    mode: str = "full",
    lines: Sequence[Any] = (),
    client_ip: Optional[str] = None,
    allow_empty: bool = False,
    log_extra: Optional[dict[str, Any]] = None,
) -> LocationTransferResult:
    """Bitta joydan boshqasiga zaxirani ko'chiradi (commit qilmaydi).

    `lines` — `product_id` / `lot_id` / `qty` atributlari bo'lgan obyektlar
    (faqat `mode="partial"` uchun).

    `allow_empty=True` bo'lsa, bo'sh joy xato emas — bo'sh natija qaytadi.
    Sektor ko'chirishda bo'sh joylar odatiy holat.

    `log_extra` audit yozuviga qo'shiladi — sektor ko'chirishi jurnalda alohida
    ajralib tursin.
    """
    extra = log_extra or {}
    result = LocationTransferResult()

    raw_rows = _get_lot_level_balances(db, product_ids=None, location_id=from_location_id)
    rows = [r for r in raw_rows if Decimal(str(r["available"])) > 0]
    if not rows and not allow_empty:
        raise HTTPException(
            status_code=400,
            detail="No available quantity to transfer at the source location",
        )

    transfer_rows, result.lines_requested = _collect_transfer_rows(
        db,
        from_location_id=from_location_id,
        mode=mode,
        lines=lines,
        rows=rows,
    )

    # "Butun palet" fizik ko'chirilganda undagi yopiq qutilar ham birga ko'chadi
    # (placement + fizik qoldiq, relocate_sealed_box kabi).
    sealed_placements: list[tuple[LocationBoxPlacementModel, ProductBoxModel]] = []
    if mode == "full":
        sealed_placements = (
            db.query(LocationBoxPlacementModel, ProductBoxModel)
            .join(ProductBoxModel, LocationBoxPlacementModel.product_box_id == ProductBoxModel.id)
            .filter(
                LocationBoxPlacementModel.location_id == from_location_id,
                LocationBoxPlacementModel.status == PLACEMENT_SEALED,
            )
            .order_by(LocationBoxPlacementModel.placed_at.asc())
            .all()
        )

    # Oldindan tekshiruv: quti ko'chadigan har bir lot uchun (1) drift bo'lsa
    # sanoqqa yo'naltiruvchi aniq xabar, (2) rezerv bo'lsa — palet to'liq
    # ko'chirilsa manbada available manfiy bo'ladi, shuning uchun aniq sabab
    # bilan bloklanadi (aks holda oxirida umumiy "Negative balance" chiqardi).
    checked_box_lots: set[UUID] = set()
    for placement, _box in sealed_placements:
        if placement.lot_id in checked_box_lots:
            continue
        checked_box_lots.add(placement.lot_id)
        assert_box_invariant(db, placement.lot_id, from_location_id)
        _oh, reserved_at_src, _av = compute_lot_location_balances(
            db, placement.lot_id, from_location_id
        )
        if reserved_at_src > 0:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Joyda rezervdagi (terish uchun band) zaxira bor: {int(reserved_at_src)} dona. "
                    "Palet to'liq ko'chirilishi uchun avval terish yakunlanishi "
                    "yoki rezerv bekor qilinishi kerak."
                ),
            )

    if not transfer_rows and not sealed_placements:
        if allow_empty:
            return result
        raise HTTPException(status_code=400, detail="No transfer lines selected")

    for r in transfer_rows:
        qty = Decimal(str(r["qty"]))
        if qty <= 0:
            continue
        product_id = r["product_id"]
        lot_id = r["lot_id"]
        lot = db.query(StockLotModel).filter(StockLotModel.id == lot_id).one_or_none()
        if not lot or lot.product_id != product_id:
            raise HTTPException(status_code=400, detail="Stock lot not found or mismatch")

        check_location_single_expiry(db, to_location_id, product_id, lot.expiry_date)
        require_sufficient_available(db, product_id, lot_id, from_location_id, qty, lock=True)

        mov_out = StockMovementModel(
            product_id=product_id,
            lot_id=lot_id,
            location_id=from_location_id,
            qty_change=-qty,
            movement_type="adjust",
            created_by_user_id=user_id,
            reason_code="inventory_shortage",
        )
        mov_in = StockMovementModel(
            product_id=product_id,
            lot_id=lot_id,
            location_id=to_location_id,
            qty_change=qty,
            movement_type="adjust",
            created_by_user_id=user_id,
            reason_code="inventory_overage",
        )
        db.add(mov_out)
        db.add(mov_in)
        db.flush()

        for mov, loc_id, qty_change in (
            (mov_out, from_location_id, -qty),
            (mov_in, to_location_id, qty),
        ):
            log_action(
                db,
                user_id=user_id,
                action=ACTION_CREATE,
                entity_type="stock_movement",
                entity_id=str(mov.id),
                new_data={
                    "product_id": str(product_id),
                    "lot_id": str(lot_id),
                    "location_id": str(loc_id),
                    "qty_change": str(qty_change),
                    "movement_type": "adjust",
                    "transfer_location_bulk": mode == "full",
                    "transfer_location_partial": mode == "partial",
                    **extra,
                },
                ip_address=client_ip,
            )
        result.movements_created += 2
        result.balance_pairs.add((lot_id, from_location_id))
        result.balance_pairs.add((lot_id, to_location_id))
        # Loose ko'chganda invariant manbada saqlanishi shart.
        result.invariant_pairs.add((lot_id, from_location_id))

    # Yopiq qutilarni ko'chirish (faqat full rejim): har placement uchun
    # transfer_out/transfer_in juftligi + placement joyi yangilanadi.
    for placement, box in sealed_placements:
        lot = db.query(StockLotModel).filter(StockLotModel.id == placement.lot_id).one_or_none()
        if not lot or lot.product_id != box.product_id:
            raise HTTPException(status_code=400, detail="Stock lot not found or mismatch")

        check_location_single_expiry(db, to_location_id, box.product_id, lot.expiry_date)
        lock_lot_location(db, placement.lot_id, from_location_id)
        lock_lot_location(db, placement.lot_id, to_location_id)

        upb = Decimal(str(box.units_per_box))
        mov_out = StockMovementModel(
            product_id=box.product_id,
            lot_id=placement.lot_id,
            location_id=from_location_id,
            qty_change=-upb,
            movement_type="transfer_out",
            created_by_user_id=user_id,
        )
        mov_in = StockMovementModel(
            product_id=box.product_id,
            lot_id=placement.lot_id,
            location_id=to_location_id,
            qty_change=upb,
            movement_type="transfer_in",
            created_by_user_id=user_id,
        )
        db.add(mov_out)
        db.add(mov_in)
        placement.location_id = to_location_id
        db.flush()

        for mov, loc_id, qty_change in (
            (mov_out, from_location_id, -upb),
            (mov_in, to_location_id, upb),
        ):
            log_action(
                db,
                user_id=user_id,
                action=ACTION_CREATE,
                entity_type="stock_movement",
                entity_id=str(mov.id),
                new_data={
                    "product_id": str(box.product_id),
                    "lot_id": str(placement.lot_id),
                    "location_id": str(loc_id),
                    "qty_change": str(qty_change),
                    "movement_type": mov.movement_type,
                    "transfer_location_bulk": True,
                    "transfer_location_box": True,
                    "box_barcode": box.box_barcode,
                    **extra,
                },
                ip_address=client_ip,
            )
        result.movements_created += 2
        result.boxes_transferred += 1
        result.balance_pairs.add((placement.lot_id, from_location_id))
        result.balance_pairs.add((placement.lot_id, to_location_id))
        # Quti ko'chgan lotlar uchun invariant ikkala tomonda ham tekshiriladi.
        result.invariant_pairs.add((placement.lot_id, from_location_id))
        result.invariant_pairs.add((placement.lot_id, to_location_id))

    result.lines_transferred = len(transfer_rows)
    return result


def assert_invariants(db: Session, pairs: set[tuple[UUID, UUID]]) -> None:
    """Ko'chirishdan keyin quti invariantini tekshiradi."""
    for lot_id, location_id in pairs:
        assert_box_invariant(db, lot_id, location_id)
