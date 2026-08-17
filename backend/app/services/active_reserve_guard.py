"""Faol yig'ish rezervlarini aniqlash — qoldiq nollash oqimlari uchun himoya.

"Faol rezerv" hujjat qatorlaridan aniqlanadi (harakatlar jadvalidan emas):
(lot, joy) juftligiga faol SO hujjatning terilmagan qatori ishora qilsa,
o'sha juftlikka yig'uvchi keladi — nollash uni chetlab o'tishi kerak.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable
from uuid import UUID

from sqlalchemy.orm import Session

from app.constants.document_status import ACTIVE_DOCUMENT_STATUSES
from app.models.document import Document, DocumentLine
from app.models.order import Order


def active_reserved_pairs(
    db: Session,
    pairs: Iterable[tuple[UUID, UUID]] | None = None,
) -> dict[tuple[UUID, UUID], list[str]]:
    """(lot_id, location_id) -> shu juftlikni band qilgan faol buyurtma raqamlari.

    Faol qator: SO hujjat ACTIVE_DOCUMENT_STATUSES da, required_qty > picked_qty,
    skip qilinmagan, VIP-informatsion emas. Buyurtma raqami bo'lmasa doc_no.

    pairs berilsa natija shu juftliklar bilan cheklanadi. Filtrlash Python
    darajasida: faol qatorlar soni kichik, kompozit IN esa SQLite testlarda
    ishonchsiz.
    """
    rows = (
        db.query(
            DocumentLine.lot_id,
            DocumentLine.location_id,
            Order.order_number,
            Document.doc_no,
        )
        .join(Document, Document.id == DocumentLine.document_id)
        .outerjoin(Order, Order.id == Document.order_id)
        .filter(
            Document.doc_type == "SO",
            Document.status.in_(ACTIVE_DOCUMENT_STATUSES),
            DocumentLine.lot_id.isnot(None),
            DocumentLine.location_id.isnot(None),
            DocumentLine.required_qty > DocumentLine.picked_qty,
            DocumentLine.skip_reason.is_(None),
            DocumentLine.is_vip_expiry_informational.is_(False),
        )
        .all()
    )
    wanted = {(lot, loc) for lot, loc in pairs} if pairs is not None else None
    grouped: dict[tuple[UUID, UUID], set[str]] = defaultdict(set)
    for lot_id, location_id, order_number, doc_no in rows:
        key = (lot_id, location_id)
        if wanted is not None and key not in wanted:
            continue
        label = (order_number or doc_no or "").strip()
        grouped[key]  # raqami topilmasa ham juftlik faol deb belgilansin
        if label:
            grouped[key].add(label)
    return {key: sorted(vals) for key, vals in grouped.items()}
