from __future__ import annotations

from app.db import SessionLocal
from app.models.document import Document, DocumentLine


def _ensure_document(
    doc_no: str,
    doc_type: str,
    status: str,
    lines: list[dict],
) -> Document:
    db = SessionLocal()
    try:
        existing = (
            db.query(Document)
            .filter(Document.doc_no == doc_no, Document.doc_type == doc_type)
            .one_or_none()
        )
        if existing:
            return existing

        document = Document(doc_no=doc_no, doc_type=doc_type, status=status)
        document.lines = [
            DocumentLine(
                sku=line.get("sku"),
                product_name=line["product_name"],
                barcode=line.get("barcode"),
                location_code=line.get("location_code", ""),
                required_qty=line["required_qty"],
                picked_qty=line.get("picked_qty", 0),
            )
            for line in lines
        ]
        db.add(document)
        db.commit()
        db.refresh(document)
        return document
    finally:
        db.close()


def main() -> None:
    _ensure_document(
        doc_no="SO-0001",
        doc_type="SO",
        status="confirmed",
        lines=[
            {
                "sku": "SKU-0001",
                "product_name": "Shampun 250ml",
                "barcode": "8600000000011",
                "location_code": "A-01-01",
                "required_qty": 5,
                "picked_qty": 0,
            },
            {
                "sku": "SKU-0002",
                "product_name": "Krem 50ml",
                "barcode": "8600000000028",
                "location_code": "A-01-02",
                "required_qty": 3,
                "picked_qty": 0,
            },
        ],
    )
    _ensure_document(
        doc_no="SO-0002",
        doc_type="SO",
        status="in_progress",
        lines=[
            {
                "sku": "SKU-0003",
                "product_name": "Gel 200ml",
                "barcode": "8600000000035",
                "location_code": "B-02-01",
                "required_qty": 4,
                "picked_qty": 1,
            }
        ],
    )


if __name__ == "__main__":
    main()
