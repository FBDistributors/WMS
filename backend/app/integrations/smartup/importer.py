from __future__ import annotations

from typing import Iterable, Tuple

from sqlalchemy.orm import Session, selectinload

from app.integrations.smartup.mapper import map_order_to_document
from app.integrations.smartup.schemas import SmartupOrder
from app.models.document import Document, DocumentLine


def import_orders(db: Session, orders: Iterable[SmartupOrder]) -> Tuple[int, int]:
    created = 0
    updated = 0

    for order in orders:
        payload = map_order_to_document(order)
        existing = (
            db.query(Document)
            .options(selectinload(Document.lines))
            .filter(
                Document.source_external_id == payload.source_external_id,
                Document.doc_type == payload.doc_type,
            )
            .one_or_none()
        )

        if existing:
            existing.doc_no = payload.doc_no
            if existing.status == "new":
                existing.status = payload.status
            existing.lines.clear()
            for line in payload.lines:
                existing.lines.append(
                    DocumentLine(
                        sku=line.sku,
                        barcode=line.barcode,
                        product_name=line.product_name,
                        location_code="",
                        required_qty=line.required_qty,
                        picked_qty=0,
                    )
                )
            updated += 1
            continue

        document = Document(
            doc_no=payload.doc_no,
            doc_type=payload.doc_type,
            status=payload.status,
            source_external_id=payload.source_external_id,
        )
        document.lines = [
            DocumentLine(
                sku=line.sku,
                barcode=line.barcode,
                product_name=line.product_name,
                location_code="",
                required_qty=line.required_qty,
                picked_qty=0,
            )
            for line in payload.lines
        ]
        db.add(document)
        created += 1

    db.commit()

    # TODO: Return per-order errors if Smartup payload has invalid lines.
    return created, updated
