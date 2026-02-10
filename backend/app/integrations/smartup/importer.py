from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Tuple

from sqlalchemy.orm import Session, selectinload

from app.integrations.smartup.mapper import map_order_to_wms_order
from app.integrations.smartup.schemas import SmartupOrder
from app.models.order import Order, OrderLine


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
        payload = map_order_to_wms_order(order)
        try:
            existing = (
                db.query(Order)
                .options(selectinload(Order.lines))
                .filter(Order.source_external_id == payload.source_external_id)
                .one_or_none()
            )

            if existing:
                existing.order_number = payload.order_number
                existing.filial_id = payload.filial_id
                existing.customer_id = payload.customer_id
                existing.customer_name = payload.customer_name
                existing.agent_id = payload.agent_id
                existing.agent_name = payload.agent_name
                existing.total_amount = payload.total_amount
                if existing.status in ("imported", "ready_for_picking", "B#S"):
                    existing.status = payload.status
                if payload.lines:
                    _upsert_lines(existing, payload.lines)
                db.commit()
                updated += 1
                continue

            record = Order(
                source=payload.source,
                source_external_id=payload.source_external_id,
                order_number=payload.order_number,
                filial_id=payload.filial_id,
                customer_id=payload.customer_id,
                customer_name=payload.customer_name,
                agent_id=payload.agent_id,
                agent_name=payload.agent_name,
                total_amount=payload.total_amount,
                status=payload.status,
            )
            record.lines = [
                OrderLine(
                    sku=line.sku,
                    barcode=line.barcode,
                    name=line.name,
                    qty=line.qty,
                    uom=line.uom,
                    raw_json=line.raw_json,
                )
                for line in payload.lines
            ]
            db.add(record)
            db.commit()
            created += 1
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            errors.append(ImportError(external_id=payload.source_external_id, reason=str(exc)))
            continue

    return created, updated, skipped, errors


def _line_key(line: OrderLine) -> Tuple[str, str, str]:
    return (line.sku or "", line.barcode or "", line.name or "")


def _payload_key(payload_line) -> Tuple[str, str, str]:
    return (payload_line.sku or "", payload_line.barcode or "", payload_line.name or "")


def _upsert_lines(order: Order, payload_lines) -> None:
    existing = {_line_key(line): line for line in order.lines}
    incoming_keys = set()

    for payload in payload_lines:
        key = _payload_key(payload)
        incoming_keys.add(key)
        if key in existing:
            line = existing[key]
            line.sku = payload.sku
            line.barcode = payload.barcode
            line.name = payload.name
            line.qty = payload.qty
            line.uom = payload.uom
            line.raw_json = payload.raw_json
            continue
        order.lines.append(
            OrderLine(
                sku=payload.sku,
                barcode=payload.barcode,
                name=payload.name,
                qty=payload.qty,
                uom=payload.uom,
                raw_json=payload.raw_json,
            )
        )

    for line in list(order.lines):
        if _line_key(line) not in incoming_keys:
            order.lines.remove(line)
