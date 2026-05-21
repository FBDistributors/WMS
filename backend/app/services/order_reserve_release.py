"""SO hujjat bekor qilinganda yoki yakunida qolgan rezervni yechish (unallocate)."""
from __future__ import annotations

from decimal import Decimal
from typing import Iterable
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.stock import StockMovement as StockMovementModel
from app.services.stock_availability import require_sufficient_reserved


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
        require_sufficient_reserved(
            db,
            line.product_id,
            line.lot_id,
            line.location_id,
            rem,
            lock=True,
        )
        db.add(
            StockMovementModel(
                product_id=line.product_id,
                lot_id=line.lot_id,
                location_id=line.location_id,
                qty_change=-rem,
                movement_type="unallocate",
                source_document_type="document",
                source_document_id=document.id,
                created_by_user_id=user_id,
            )
        )
        released_lines += 1
    return released_lines
