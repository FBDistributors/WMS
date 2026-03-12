from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, Iterable, List, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.integrations.smartup.mapper import OrderLinePayload, _resolve_external_id, map_order_to_wms_order
from app.integrations.smartup.schemas import SmartupOrder
from app.models.order import Order, OrderLine, OrderWmsState
from app.models.product import Product as ProductModel

logger = logging.getLogger(__name__)


def _enrich_order_line_names_from_products(db: Session, lines: List[OrderLinePayload]) -> None:
    """Order line nomi bo'sh yoki faqat SKU bo'lsa, products jadvalidan SKU bo'yicha to'liq nomni olib to'ldiradi."""
    for line in lines:
        sku_str = (line.sku or "").strip()
        if not sku_str:
            continue
        name_str = (line.name or "").strip()
        if name_str and name_str != sku_str and len(name_str) >= 3:
            continue
        product = db.query(ProductModel).filter(ProductModel.sku == sku_str).first()
        if product and (product.name or "").strip():
            line.name = (product.name or "").strip()[:255]


@dataclass
class ImportError:
    external_id: str
    reason: str


def _classify_import_error(exc: BaseException) -> str:
    """Xato sababini tasniflash: duplicate_conflict, db_error, validation_error."""
    msg = (str(exc) or "").lower()
    if isinstance(exc, IntegrityError):
        if "unique" in msg or "duplicate" in msg or "already exists" in msg or "uq_" in msg:
            return "duplicate_conflict"
        return "db_error"
    if "not null" in msg or "nullable" in msg or "required" in msg:
        return "validation_error"
    if "foreign key" in msg or "constraint" in msg or "integrity" in msg:
        return "db_error"
    return "db_error"


def _process_one_order(
    db: Session,
    order: SmartupOrder,
    override: str | None,
    order_source: str | None,
    skipped_by_reason: Dict[str, int],
    errors: List[ImportError],
    do_commit: bool,
) -> Tuple[int, int, int]:
    """Process a single order. Returns (created_inc, updated_inc, skipped_inc). On exception: rollback if do_commit, append to errors, return (0,0,1)."""
    external_id = _resolve_external_id(order)
    if not (external_id or "").strip():
        skipped_by_reason["missing_key"] = skipped_by_reason.get("missing_key", 0) + 1
        errors.append(ImportError(external_id="", reason="external_id bo'sh, fallback ham yo'q"))
        return 0, 0, 1
    if override and not (order.filial_id or order.filial_code) and order.deal_id:
        external_id = f"{order.deal_id}:{override}"
    existing = (
        db.query(Order)
        .options(selectinload(Order.lines))
        .filter(Order.source_external_id == external_id)
        .one_or_none()
    )
    payload = map_order_to_wms_order(order)
    payload.status = (order.status or "").strip() or "imported"
    if override and not (payload.filial_id or "").strip():
        payload.filial_id = override
    if override and external_id != payload.source_external_id:
        payload.source_external_id = external_id
    source = order_source if order_source else payload.source
    try:
        _enrich_order_line_names_from_products(db, payload.lines)
        if existing:
            existing.source = source
            existing.order_number = payload.order_number
            existing.filial_id = payload.filial_id
            existing.customer_id = payload.customer_id
            existing.customer_name = payload.customer_name
            existing.agent_id = payload.agent_id
            existing.agent_name = payload.agent_name
            existing.total_amount = payload.total_amount
            if getattr(payload, "from_warehouse_code", None) is not None:
                existing.from_warehouse_code = payload.from_warehouse_code
            if getattr(payload, "to_warehouse_code", None) is not None:
                existing.to_warehouse_code = payload.to_warehouse_code
            if getattr(payload, "movement_note", None) is not None:
                existing.movement_note = payload.movement_note
            if getattr(payload, "delivery_date", None) is not None:
                existing.delivery_date = payload.delivery_date
            if payload.lines:
                _upsert_lines(existing, payload.lines)
            if do_commit:
                db.commit()
            return 0, 1, 0
        record = Order(
            source=source,
            source_external_id=payload.source_external_id,
            order_number=payload.order_number,
            filial_id=payload.filial_id,
            customer_id=payload.customer_id,
            customer_name=payload.customer_name,
            agent_id=payload.agent_id,
            agent_name=payload.agent_name,
            total_amount=payload.total_amount,
            from_warehouse_code=getattr(payload, "from_warehouse_code", None),
            to_warehouse_code=getattr(payload, "to_warehouse_code", None),
            movement_note=getattr(payload, "movement_note", None),
            delivery_date=getattr(payload, "delivery_date", None),
        )
        record.wms_state = OrderWmsState(status=payload.status)
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
        if do_commit:
            db.commit()
        return 1, 0, 0
    except Exception as exc:  # noqa: BLE001
        if do_commit:
            db.rollback()
        reason_key = _classify_import_error(exc)
        if reason_key not in skipped_by_reason:
            reason_key = "exception"
        skipped_by_reason[reason_key] = skipped_by_reason.get(reason_key, 0) + 1
        logger.exception(
            "O'rikzor import xato: external_id=%s sabab=%s reason_key=%s",
            payload.source_external_id,
            exc,
            reason_key,
        )
        errors.append(ImportError(external_id=payload.source_external_id, reason=str(exc)))
        return 0, 0, 1


def import_orders(
    db: Session,
    orders: Iterable[SmartupOrder],
    order_source: str | None = None,
    filial_id_override: str | None = None,
    batch_size: int = 50,
) -> Tuple[int, int, int, List[ImportError], Dict[str, int]]:
    created = 0
    updated = 0
    skipped = 0
    errors: List[ImportError] = []
    skipped_by_reason: Dict[str, int] = {
        "status_not_allowed": 0,
        "missing_key": 0,
        "product_not_found": 0,
        "warehouse_null_or_not_found": 0,
        "warehouse_not_found": 0,
        "db_error": 0,
        "validation_error": 0,
        "duplicate_conflict": 0,
        "exception": 0,
    }
    override = (filial_id_override or "").strip() or None
    orders_list = list(orders)
    batch_size = max(1, min(batch_size, 200))

    for start in range(0, len(orders_list), batch_size):
        chunk = orders_list[start : start + batch_size]
        batch_created, batch_updated, batch_skipped = 0, 0, 0
        try:
            for order in chunk:
                c, u, s = _process_one_order(
                    db, order, override, order_source, skipped_by_reason, errors, do_commit=False
                )
                batch_created += c
                batch_updated += u
                batch_skipped += s
            db.commit()
            created += batch_created
            updated += batch_updated
            skipped += batch_skipped
            if batch_created or batch_updated:
                logger.debug(
                    "import_orders batch commit: start=%s size=%s created=%s updated=%s",
                    start,
                    len(chunk),
                    batch_created,
                    batch_updated,
                )
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            logger.warning("import_orders batch failed at start=%s, falling back to per-order: %s", start, exc)
            for order in chunk:
                c, u, s = _process_one_order(
                    db, order, override, order_source, skipped_by_reason, errors, do_commit=True
                )
                created += c
                updated += u
                skipped += s

    if orders_list and (created + updated) > 0:
        for i, order in enumerate(orders_list[:3]):
            ext = _resolve_external_id(order)
            logger.info(
                "O'rikzor import preview [%s]: external_id=%s order_no=%s status=%s lines=%s",
                i,
                ext,
                order.order_no,
                order.status,
                len(order.lines) if order.lines else 0,
            )

    logger.info(
        "import_orders done: created=%s updated=%s skipped=%s errors=%s batch_size=%s",
        created,
        updated,
        skipped,
        len(errors),
        batch_size,
    )
    return created, updated, skipped, errors, skipped_by_reason


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
