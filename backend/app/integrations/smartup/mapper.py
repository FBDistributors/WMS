from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from app.integrations.smartup.schemas import SmartupOrder


@dataclass
class OrderLinePayload:
    sku: Optional[str]
    barcode: Optional[str]
    name: str
    qty: float
    uom: Optional[str]
    raw_json: Optional[dict]


@dataclass
class OrderPayload:
    source: str
    source_external_id: str
    order_number: str
    filial_id: Optional[str]
    customer_name: Optional[str]
    status: str
    lines: List[OrderLinePayload]


def map_order_to_wms_order(order: SmartupOrder) -> OrderPayload:
    external_id = _resolve_external_id(order)
    lines = [
        OrderLinePayload(
            sku=line.sku,
            barcode=line.barcode,
            name=line.name or "Unknown item",
            qty=line.qty or 0,
            uom=line.uom,
            raw_json=line.model_dump(by_alias=True),
        )
        for line in order.lines
    ]
    return OrderPayload(
        source="smartup",
        source_external_id=external_id,
        order_number=order.order_no or order.deal_id or external_id,
        filial_id=order.filial_id,
        customer_name=order.customer_name,
        status="B#S",
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
