"""SO hujjat bekor qilinganda yoki yakunida qolgan rezervni yechish (unallocate)."""
from __future__ import annotations

from decimal import Decimal
from typing import Iterable
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.stock import StockMovement as StockMovementModel
from app.services.stock_availability import (
    compute_lot_location_balances,
    lock_lot_location,
)


def _line_is_vip_expiry_informational(line: DocumentLineModel) -> bool:
    return bool(getattr(line, "is_vip_expiry_informational", False))


def release_document_reserve_on_cancel(
    db: Session,
    document: DocumentModel,
    lines: Iterable[DocumentLineModel],
    user_id: UUID,
) -> int:
    """
    Har qator uchun rem = required_qty - picked_qty bo'yicha unallocate (-) yozadi.
    Controller complete dagi terilmagan qism yechish bilan bir xil formula.
    skip_reason qatorlarida picked_qty=0 — to'liq required_qty rezervdan yechiladi.

    Yechiladigan miqdor joydagi HAQIQIY rezervдан oshmaydi (cap): agar rezerv
    allaqachon boshqa oqimda yechilган bo'lsa (masalan controller qatorni brak
    zonaga belgilaganда — terishда rezerv ketган), bu yerда qayta yechishга
    urinib 409 bermaydi, bor rezervni yechadi.
    """
    released_lines = 0
    for line in lines:
        if _line_is_vip_expiry_informational(line):
            continue
        if not line.product_id or not line.lot_id or not line.location_id:
            continue
        req = Decimal(str(line.required_qty or 0))
        picked = Decimal(str(line.picked_qty or 0))
        rem = req - picked
        if rem <= 0:
            continue
        lock_lot_location(db, line.lot_id, line.location_id)
        _oh, reserved, _av = compute_lot_location_balances(db, line.lot_id, line.location_id)
        release = min(rem, Decimal(str(reserved)))
        if release <= 0:
            continue
        db.add(
            StockMovementModel(
                product_id=line.product_id,
                lot_id=line.lot_id,
                location_id=line.location_id,
                qty_change=-release,
                movement_type="unallocate",
                source_document_type="document",
                source_document_id=document.id,
                created_by_user_id=user_id,
            )
        )
        released_lines += 1
    return released_lines
