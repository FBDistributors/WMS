"""Stock business rules: bitta lokatsiyada bitta mahsulot = bitta muddat."""

from __future__ import annotations

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel

# Qoida: bitta lokatsiyaga bir xil mahsulotni ikki xil muddat bilan kirg'azish taqiqlanadi.
LOCATION_SINGLE_EXPIRY_MSG = (
    "Bitta lokatsiyaga ikki xil muddati bor mahsulotni kirg'azish taqiqlanadi. "
    "Ushbu lokatsiyada bu mahsulot boshqa muddat bilan mavjud."
)


def existing_expiry_dates_for_location_product(
    db: Session, location_id: UUID, product_id: UUID
) -> set:
    """Return set of distinct expiry_date (date | None) for this location + product."""
    rows = (
        db.query(StockLotModel.expiry_date)
        .join(StockMovementModel, StockMovementModel.lot_id == StockLotModel.id)
        .filter(
            StockMovementModel.location_id == location_id,
            StockLotModel.product_id == product_id,
        )
        .distinct()
        .all()
    )
    return {r[0] for r in rows}


def check_location_single_expiry(
    db: Session,
    location_id: UUID,
    product_id: UUID,
    new_expiry_normalized: Optional[date],
) -> None:
    """Raise HTTP 400 if location already has this product with a different expiry."""
    existing = existing_expiry_dates_for_location_product(db, location_id, product_id)
    if not existing:
        return
    if len(existing) > 1:
        raise HTTPException(
            status_code=400,
            detail=LOCATION_SINGLE_EXPIRY_MSG,
        )
    (only_expiry,) = existing
    if only_expiry != new_expiry_normalized:
        raise HTTPException(
            status_code=400,
            detail=LOCATION_SINGLE_EXPIRY_MSG,
        )
