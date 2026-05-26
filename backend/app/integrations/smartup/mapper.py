from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from app.constants.order_wms_status import normalize_order_wms_status_for_storage
from app.constants.smartup_org_filials import (
    normalize_smartup_org_filial_id,
    resolve_org_filial_id_from_note,
)
from app.integrations.smartup.schemas import SmartupOrder


@dataclass
class OrderLinePayload:
    sku: Optional[str]
    barcode: Optional[str]
    name: str
    qty: float
    uom: Optional[str]
    raw_json: Optional[dict]
    line_source: str = "product"


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
    from_warehouse_code: Optional[str] = None
    to_warehouse_code: Optional[str] = None
    to_filial_code: Optional[str] = None
    movement_note: Optional[str] = None
    delivery_date: Optional[datetime] = None
    delivery_number: Optional[str] = None


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
            line_source=line.line_source or "product",
        )
        for line in order.lines
    ]
    wms_status = normalize_order_wms_status_for_storage(order.status)
    org_filial = normalize_smartup_org_filial_id(
        getattr(order, "to_filial_code", None) or order.filial_id
    ) or resolve_org_filial_id_from_note(getattr(order, "note", None))
    _dn = (str(order.delivery_number).strip() if order.delivery_number is not None else "")
    dn = _dn[:64] if _dn else None
    return OrderPayload(
        source="smartup",
        source_external_id=external_id,
        order_number=order.order_no or order.delivery_number or order.deal_id or external_id,
        filial_id=org_filial,
        customer_id=order.customer_id,
        customer_name=order.customer_name,
        agent_id=order.agent_id,
        agent_name=order.agent_name,
        total_amount=order.total_amount,
        status=wms_status,
        lines=lines,
        from_warehouse_code=getattr(order, "from_warehouse_code", None) or None,
        to_warehouse_code=getattr(order, "to_warehouse_code", None) or None,
        to_filial_code=org_filial,
        movement_note=getattr(order, "note", None) or None,
        delivery_date=order.delivery_date,
        delivery_number=dn,
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
