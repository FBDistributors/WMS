"""
Lot + joy bo‘yicha available (on_hand - reserved) — picker_inventory bilan bir xil formula.
Manfiy qoldiqni oldini olish: chiqimdan oldin tekshiruv + PostgreSQL advisory lock.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import case, func, text
from sqlalchemy.orm import Session

from app.models.stock import ON_HAND_MOVEMENT_TYPES
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel


def _advisory_keys(lot_id: UUID, location_id: UUID) -> tuple[int, int]:
    k1 = int.from_bytes(lot_id.bytes[:8], "big", signed=False) % (2**31 - 1) + 1
    k2 = int.from_bytes(location_id.bytes[:8], "big", signed=False) % (2**31 - 1) + 1
    return (k1, k2)


def lock_lot_location(db: Session, lot_id: UUID, location_id: UUID) -> None:
    """PostgreSQL: (lot, joy) jufti bo‘yicha tranzaksiya qulfi. SQLite testda no-op."""
    if db.get_bind().dialect.name != "postgresql":
        return
    k1, k2 = _advisory_keys(lot_id, location_id)
    # PostgreSQL: ikki argumentli shakl faqat (integer, integer); (bigint, bigint) yo‘q.
    db.execute(
        text("SELECT pg_advisory_xact_lock(CAST(:k1 AS INTEGER), CAST(:k2 AS INTEGER))"),
        {"k1": k1, "k2": k2},
    )


def compute_lot_location_available(db: Session, lot_id: UUID, location_id: UUID) -> Decimal:
    """_get_lot_level_balances bilan bir xil: available = on_hand - reserved."""
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
    row = (
        db.query((on_hand_expr - reserved_expr).label("available"))
        .select_from(StockMovementModel)
        .join(StockLotModel, StockLotModel.id == StockMovementModel.lot_id)
        .filter(
            StockMovementModel.lot_id == lot_id,
            StockMovementModel.location_id == location_id,
        )
        .group_by(StockLotModel.id, StockMovementModel.location_id)
        .one_or_none()
    )
    if row is None or row.available is None:
        return Decimal("0")
    return Decimal(str(row.available))


def require_sufficient_available(
    db: Session,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
    qty: Decimal,
    *,
    lock: bool = True,
) -> None:
    """qty > 0 bo‘lsa, available < qty → 409."""
    if qty <= 0:
        return
    if lock:
        lock_lot_location(db, lot_id, location_id)
    lot = db.get(StockLotModel, lot_id)
    if not lot or lot.product_id != product_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid lot for product")
    avail = compute_lot_location_available(db, lot_id, location_id)
    if qty > avail:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Yetarli qoldiq yo'q (lot/joy: mavjud {avail}, so'ralgan {qty})",
        )
