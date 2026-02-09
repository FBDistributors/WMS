from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from app.integrations.smartup.schemas import SmartupOrder


@dataclass
class DocumentLinePayload:
    sku: Optional[str]
    barcode: Optional[str]
    product_name: str
    required_qty: float


@dataclass
class DocumentPayload:
    doc_no: str
    doc_type: str
    status: str
    source_external_id: str
    lines: List[DocumentLinePayload]


def map_order_to_document(order: SmartupOrder) -> DocumentPayload:
    doc_no = order.order_no or order.external_id
    lines = [
        DocumentLinePayload(
            sku=line.sku,
            barcode=line.barcode,
            product_name=line.name,
            required_qty=line.qty,
        )
        for line in order.lines
    ]
    # TODO: Add mapping for locations when Smartup provides them.
    return DocumentPayload(
        doc_no=doc_no,
        doc_type="SO",
        status="new",
        source_external_id=order.external_id,
        lines=lines,
    )
