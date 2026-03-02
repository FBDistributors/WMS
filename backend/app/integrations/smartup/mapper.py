from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
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
    customer_id: Optional[str]
    customer_name: Optional[str]
    agent_id: Optional[str]
    agent_name: Optional[str]
    total_amount: Optional[Decimal]
    status: str
    lines: List[OrderLinePayload]


def map_order_to_wms_order(order: SmartupOrder) -> OrderPayload:
    external_id = _resolve_external_id(order)
    def _name(s: str | None) -> str:
        out = (s or "").strip() or "Unknown item"
        return out[:255] if len(out) > 255 else out  # OrderLine.name max 255

    lines = [
        OrderLinePayload(
            sku=line.sku,
            barcode=line.barcode,
            name=_name(line.name),
            qty=line.qty or 0,
            uom=line.uom,
            raw_json=line.model_dump(by_alias=True),
        )
        for line in order.lines
    ]
    return OrderPayload(
        source="smartup",
        source_external_id=external_id,
        order_number=order.order_no or order.delivery_number or order.deal_id or external_id,
        filial_id=order.filial_id,
        customer_id=order.customer_id,
        customer_name=order.customer_name,
        agent_id=order.agent_id,
        agent_name=order.agent_name,
        total_amount=order.total_amount,
        status="B#S",
        lines=lines,
    )


def _resolve_external_id(order: SmartupOrder) -> str:
    """Idempotency uchun: external_id yoki deal_id bo'lmasa movement:order_no ishlatiladi."""
    if order.external_id and str(order.external_id).strip():
        return str(order.external_id).strip()
    if order.deal_id and str(order.deal_id).strip():
        if order.filial_id and str(order.filial_id).strip():
            return f"{order.deal_id}:{order.filial_id}"
        return str(order.deal_id).strip()
    if order.order_no and str(order.order_no).strip():
        return f"movement:{order.order_no}"
    return "smartup:unknown"
