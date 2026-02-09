from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
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
    source: str
    source_external_id: str
    source_document_date: Optional[datetime]
    source_customer_name: Optional[str]
    source_filial_id: Optional[str]
    lines: List[DocumentLinePayload]


def map_order_to_document(order: SmartupOrder) -> DocumentPayload:
    external_id = _resolve_external_id(order)
    doc_no = order.order_no or order.deal_id or external_id
    lines = [
        DocumentLinePayload(
            sku=line.sku,
            barcode=line.barcode,
            product_name=line.name or "Unknown item",
            required_qty=line.qty or 0,
        )
        for line in order.lines
    ]
    # TODO: Add mapping for locations when Smartup provides them.
    return DocumentPayload(
        doc_no=doc_no,
        doc_type="SO",
        status="smartup_created",
        source="smartup",
        source_external_id=external_id,
        source_document_date=order.delivery_date or order.deal_time or order.created_on,
        source_customer_name=order.customer_name,
        source_filial_id=order.filial_id,
        lines=lines,
    )


def _resolve_external_id(order: SmartupOrder) -> str:
    if order.external_id:
        return order.external_id
    if order.deal_id and order.filial_id:
        return f"{order.deal_id}:{order.filial_id}"
    if order.deal_id:
        return order.deal_id
    # TODO: Decide fallback behavior when both external_id and deal_id are empty.
    return f"smartup:{order.order_no or 'unknown'}"
