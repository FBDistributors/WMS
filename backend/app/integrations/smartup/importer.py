from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Tuple

from sqlalchemy.orm import Session, selectinload

from app.integrations.smartup.mapper import map_order_to_document
from app.integrations.smartup.schemas import SmartupOrder
from app.models.document import Document, DocumentLine


@dataclass
class ImportError:
    external_id: str
    reason: str


def import_orders(db: Session, orders: Iterable[SmartupOrder]) -> Tuple[int, int, int, List[ImportError]]:
    created = 0
    updated = 0
    skipped = 0
    errors: List[ImportError] = []

    for order in orders:
        payload = map_order_to_document(order)
        if not payload.lines:
            skipped += 1
            continue

        try:
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
                existing.source = payload.source
                existing.source_document_date = payload.source_document_date
                existing.source_customer_name = payload.source_customer_name
                existing.source_filial_id = payload.source_filial_id
                if existing.status == "smartup_created":
                    existing.status = payload.status
                _upsert_lines(existing, payload.lines)
                db.commit()
                updated += 1
                continue

            document = Document(
                doc_no=payload.doc_no,
                doc_type=payload.doc_type,
                status=payload.status,
                source=payload.source,
                source_external_id=payload.source_external_id,
                source_document_date=payload.source_document_date,
                source_customer_name=payload.source_customer_name,
                source_filial_id=payload.source_filial_id,
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
            db.commit()
            created += 1
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            errors.append(ImportError(external_id=payload.source_external_id, reason=str(exc)))
            continue

    return created, updated, skipped, errors


def _line_key(line: DocumentLine) -> Tuple[str, str, str]:
    return (line.sku or "", line.barcode or "", line.product_name or "")


def _payload_key(payload_line) -> Tuple[str, str, str]:
    return (payload_line.sku or "", payload_line.barcode or "", payload_line.product_name or "")


def _upsert_lines(document: Document, payload_lines) -> None:
    existing = { _line_key(line): line for line in document.lines }
    incoming_keys = set()

    for payload in payload_lines:
        key = _payload_key(payload)
        incoming_keys.add(key)
        if key in existing:
            line = existing[key]
            line.sku = payload.sku
            line.barcode = payload.barcode
            line.product_name = payload.product_name
            line.required_qty = payload.required_qty
            continue
        document.lines.append(
            DocumentLine(
                sku=payload.sku,
                barcode=payload.barcode,
                product_name=payload.product_name,
                location_code="",
                required_qty=payload.required_qty,
                picked_qty=0,
            )
        )

    for line in list(document.lines):
        if _line_key(line) not in incoming_keys:
            document.lines.remove(line)
