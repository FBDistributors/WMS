from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Dict, FrozenSet, Iterable, List, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.constants.order_wms_status import (
    normalize_order_wms_status_for_storage,
    smartup_movement_status_for_wms_storage,
    smartup_orikzor_status_for_wms_storage,
)
from app.constants.smartup_org_filials import normalize_smartup_org_filial_id
from app.services.organization_labels import load_org_name_map
from app.integrations.smartup.mapper import (
    OrderLinePayload,
    OrderPayload,
    _resolve_external_id,
    map_order_to_wms_order,
)
from app.integrations.smartup.schemas import SmartupOrder
from app.models.order import Order, OrderLine, OrderWmsState
from app.models.product import Product as ProductModel
from app.models.work_zone import WorkZone

logger = logging.getLogger(__name__)

WORKFLOW_LOCKED_STATUSES = frozenset(
    {
        "allocated",
        "picking",
        "picked",
        "completed",
        "packed",
        "shipped",
        "cancelling_in_progress",
        "cancelled",
    }
)
FINAL_FROZEN_STATUSES = frozenset({"completed", "packed", "shipped"})
ORIKZOR_S_REQUEUE_FROM_STATUSES = frozenset({"completed", "packed", "shipped", "W", "imported"})


def _orikzor_smartup_s_requeue(
    order_src: str,
    incoming_status: str | None,
    current_status: str | None,
) -> bool:
    """Smartup S qayta kelganda eski completed/W/imported yozuvni S navbatiga qaytarish."""
    return (
        order_src == "orikzor"
        and (incoming_status or "").strip().upper() == "S"
        and (current_status or "") in ORIKZOR_S_REQUEUE_FROM_STATUSES
    )


def reconcile_diller_imported_status_to_w(db: Session) -> int:
    """Eski sinxronlardan qolgan source=diller, status=imported yozuvlarni W ga yangilaydi."""
    rows = (
        db.query(OrderWmsState)
        .join(Order, Order.id == OrderWmsState.order_id)
        .filter(Order.source == "diller", OrderWmsState.status == "imported")
        .all()
    )
    if not rows:
        return 0
    for ows in rows:
        ows.status = "W"
    db.commit()
    logger.info("reconcile_diller_imported_status_to_w: %s ta yozuv imported -> W", len(rows))
    return len(rows)


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


def load_excluded_room_ids(db: Session) -> FrozenSet[str]:
    """room_id values configured in work_zones (main SmartUp import exclusions)."""
    rows = db.query(WorkZone.room_id).all()
    return frozenset((str(r[0]).strip() for r in rows if r[0] and str(r[0]).strip()))


def _apply_order_filial_fields(
    order: Order,
    payload: OrderPayload,
    org_name_map: dict[str, str] | None = None,
) -> None:
    """SmartUP to_filial_code → settings org_id; ombor kodi (001) saqlanmasin.

    Faqat haqiqiy org_id ishlatiladi. Izohdan fuzzy-taxmin ATAYLAB olib tashlandi —
    u noto'g'ri tashkilotni order'ga yozib qo'yardi. org_id bo'lmasa o'zgartirilmaydi.
    """
    _ = org_name_map
    org_id = normalize_smartup_org_filial_id(getattr(payload, "to_filial_code", None)) or normalize_smartup_org_filial_id(
        payload.filial_id
    )
    if not org_id:
        return
    order.to_filial_code = org_id
    order.filial_id = org_id


def _process_one_order(
    db: Session,
    order: SmartupOrder,
    override: str | None,
    order_source: str | None,
    skipped_by_reason: Dict[str, int],
    errors: List[ImportError],
    do_commit: bool,
    excluded_room_ids: FrozenSet[str] | None = None,
    org_name_map: dict[str, str] | None = None,
) -> Tuple[int, int, int]:
    """Process a single order. Returns (created_inc, updated_inc, skipped_inc). On exception: rollback if do_commit, append to errors, return (0,0,1)."""
    if excluded_room_ids:
        rid = (order.room_id or "").strip()
        if rid and rid in excluded_room_ids:
            skipped_by_reason["work_zone_excluded"] = skipped_by_reason.get("work_zone_excluded", 0) + 1
            return 0, 0, 1
    external_id = _resolve_external_id(order)
    if not (external_id or "").strip():
        skipped_by_reason["missing_key"] = skipped_by_reason.get("missing_key", 0) + 1
        errors.append(ImportError(external_id="", reason="external_id bo'sh, fallback ham yo'q"))
        return 0, 0, 1
    if override and not (order.filial_id or order.filial_code) and order.deal_id:
        external_id = f"{order.deal_id}:{override}"
    existing = (
        db.query(Order)
        .options(selectinload(Order.lines), selectinload(Order.wms_state))
        .filter(Order.source_external_id == external_id)
        .one_or_none()
    )
    payload = map_order_to_wms_order(order)
    order_src = (order_source or "").strip().lower()
    if order_src == "diller":
        payload.status = smartup_movement_status_for_wms_storage(order.status)
        # Izohdan fuzzy org_id taxmini ATAYLAB olib tashlandi — faqat SmartUP dagi
        # haqiqiy to_filial_code ishlatiladi. Bo'lmasa filial bo'sh qoladi.
    elif order_src == "orikzor":
        payload.status = smartup_orikzor_status_for_wms_storage(order.status)
    else:
        raw_status = (order.status or "").strip()
        if raw_status:
            payload.status = normalize_order_wms_status_for_storage(raw_status)
    if override and not (payload.filial_id or "").strip():
        payload.filial_id = override
    if override and external_id != payload.source_external_id:
        payload.source_external_id = external_id
    source = order_source if order_source else payload.source
    incoming_status = normalize_order_wms_status_for_storage(payload.status)
    try:
        _enrich_order_line_names_from_products(db, payload.lines)
        if existing:
            current_status = normalize_order_wms_status_for_storage(
                existing.wms_state.status if existing.wms_state else None
            )
            orikzor_s_requeue = _orikzor_smartup_s_requeue(order_src, incoming_status, current_status)
            if (
                not orikzor_s_requeue
                and current_status in FINAL_FROZEN_STATUSES
                and _order_lines_fingerprint_from_order(existing)
                == _order_lines_fingerprint_from_payload(payload.lines)
            ):
                skipped_by_reason["completed_match_skipped"] = (
                    skipped_by_reason.get("completed_match_skipped", 0) + 1
                )
                logger.info(
                    "import_orders: skip matched reimport for finalized order %s (status=%s)",
                    external_id,
                    current_status,
                )
                filial_before = (existing.to_filial_code or existing.filial_id or "").strip()
                _apply_order_filial_fields(existing, payload, org_name_map)
                filial_after = (existing.to_filial_code or existing.filial_id or "").strip()
                if getattr(payload, "from_warehouse_code", None) is not None:
                    existing.from_warehouse_code = payload.from_warehouse_code
                if getattr(payload, "to_warehouse_code", None) is not None:
                    existing.to_warehouse_code = payload.to_warehouse_code
                if do_commit:
                    db.commit()
                if filial_after and filial_after != filial_before:
                    return 0, 1, 0
                return 0, 0, 1
            existing.source = source
            existing.order_number = payload.order_number
            _apply_order_filial_fields(existing, payload, org_name_map)
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
            if getattr(payload, "delivery_number", None) is not None:
                existing.delivery_number = getattr(payload, "delivery_number", None)
            if existing.wms_state:
                if orikzor_s_requeue or current_status not in WORKFLOW_LOCKED_STATUSES:
                    existing.wms_state.status = incoming_status
                else:
                    logger.info(
                        "import_orders: preserve wms status for %s (current=%s, incoming=%s)",
                        external_id,
                        current_status,
                        incoming_status,
                    )
            else:
                existing.wms_state = OrderWmsState(
                    status=normalize_order_wms_status_for_storage(payload.status)
                )
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
            delivery_number=getattr(payload, "delivery_number", None),
        )
        _apply_order_filial_fields(record, payload, org_name_map)
        record.wms_state = OrderWmsState(status=normalize_order_wms_status_for_storage(payload.status))
        record.lines = [
            OrderLine(
                sku=line.sku,
                barcode=line.barcode,
                name=line.name,
                qty=line.qty,
                uom=line.uom,
                line_source=line.line_source,
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


STALE_ORDER_STATUSES = ("imported", "W")
ORIKZOR_STALE_ORDER_STATUSES = ("S",)


def _stale_order_statuses(order_source: str | None) -> tuple[str, ...]:
    if (order_source or "").strip().lower() == "orikzor":
        return ORIKZOR_STALE_ORDER_STATUSES
    return STALE_ORDER_STATUSES


def _external_ids_to_keep_from_smartup(
    orders_from_smartup: Iterable[SmartupOrder],
    excluded_room_ids: FrozenSet[str] | None = None,
) -> set[str]:
    """Work zone chiqarilgan buyurtmalar keep ro'yxatiga kirmaydi."""
    keep: set[str] = set()
    for order in orders_from_smartup:
        rid = (order.room_id or "").strip()
        if excluded_room_ids and rid and rid in excluded_room_ids:
            continue
        ext = (_resolve_external_id(order) or "").strip()
        if ext:
            keep.add(ext)
    return keep


def _external_ids_excluded_work_zones(
    orders_from_smartup: Iterable[SmartupOrder],
    excluded_room_ids: FrozenSet[str] | None,
) -> set[str]:
    if not excluded_room_ids:
        return set()
    out: set[str] = set()
    for order in orders_from_smartup:
        rid = (order.room_id or "").strip()
        if rid and rid in excluded_room_ids:
            ext = (_resolve_external_id(order) or "").strip()
            if ext:
                out.add(ext)
    return out


def _delete_imported_orders_by_external_ids(
    db: Session,
    external_ids: set[str],
    *,
    order_source: str | None = None,
) -> int:
    if not external_ids:
        return 0
    stale_statuses = _stale_order_statuses(order_source)
    filters = [
        OrderWmsState.status.in_(stale_statuses),
        Order.source_external_id.in_(external_ids),
    ]
    src = (order_source or "").strip()
    if src:
        filters.append(Order.source == src)
    ids_to_delete = [
        row[0]
        for row in db.query(Order.id)
        .join(OrderWmsState, Order.id == OrderWmsState.order_id)
        .filter(*filters)
        .all()
    ]
    if not ids_to_delete:
        return 0
    return db.query(Order).filter(Order.id.in_(ids_to_delete)).delete(synchronize_session=False)


def delete_stale_orders(
    db: Session,
    orders_from_smartup: List[SmartupOrder],
    *,
    order_source: str | None = None,
    excluded_room_ids: FrozenSet[str] | None = None,
) -> int:
    """
    SmartUp eksportida kelmagan va hali workflow da bo'lmagan (imported yoki W) buyurtmalarni o'chiradi.
    Picking, allocated, picked, completed va boshqa statusdagilar o'chirilmaydi.
    order_source berilsa — faqat shu manba (masalan diller) yozuvlari.
    excluded_room_ids: work zone — import skip + yangi/yangi holatdagi yozuvlar sinxron da o'chiriladi.
    """
    if not orders_from_smartup:
        logger.warning("delete_stale_orders: SmartUp javobi bo'sh, o'chirish o'tkazilmaydi")
        return 0

    external_ids_to_keep = _external_ids_to_keep_from_smartup(orders_from_smartup, excluded_room_ids)
    excluded_ext = _external_ids_excluded_work_zones(orders_from_smartup, excluded_room_ids)

    deleted = 0
    if excluded_ext:
        n = _delete_imported_orders_by_external_ids(db, excluded_ext, order_source=order_source)
        if n:
            logger.info("delete_stale_orders: work_zone excluded %d ta buyurtma o'chirildi", n)
        deleted += n

    if not external_ids_to_keep:
        db.commit()
        return deleted

    stale_statuses = _stale_order_statuses(order_source)
    filters = [
        OrderWmsState.status.in_(stale_statuses),
        Order.source_external_id.notin_(external_ids_to_keep),
    ]
    src = (order_source or "").strip()
    if src:
        filters.append(Order.source == src)
    ids_to_delete = [
        row[0]
        for row in db.query(Order.id)
        .join(OrderWmsState, Order.id == OrderWmsState.order_id)
        .filter(*filters)
        .all()
    ]
    if ids_to_delete:
        deleted += db.query(Order).filter(Order.id.in_(ids_to_delete)).delete(synchronize_session=False)
        logger.info("delete_stale_orders: %d ta eski buyurtma o'chirildi (%s)", len(ids_to_delete), stale_statuses)
    db.commit()
    return deleted


def import_orders(
    db: Session,
    orders: Iterable[SmartupOrder],
    order_source: str | None = None,
    filial_id_override: str | None = None,
    batch_size: int = 50,
    exclude_work_zones: bool = False,
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
        "completed_match_skipped": 0,
        "work_zone_excluded": 0,
    }
    excluded_room_ids: FrozenSet[str] | None = None
    if exclude_work_zones:
        excluded_room_ids = load_excluded_room_ids(db)
    override = (filial_id_override or "").strip() or None
    orders_list = list(orders)
    batch_size = max(1, min(batch_size, 200))
    org_name_map: dict[str, str] | None = None
    if (order_source or "").strip().lower() == "diller":
        org_name_map = load_org_name_map(db)
        if not org_name_map:
            logger.warning(
                "import_orders(diller): settings_organizations bo'sh — "
                "Filial nomlari Sozlamalar → Organizatsiya dan to'ldiring"
            )

    for start in range(0, len(orders_list), batch_size):
        chunk = orders_list[start : start + batch_size]
        batch_created, batch_updated, batch_skipped = 0, 0, 0
        try:
            for order in chunk:
                c, u, s = _process_one_order(
                    db,
                    order,
                    override,
                    order_source,
                    skipped_by_reason,
                    errors,
                    do_commit=False,
                    excluded_room_ids=excluded_room_ids,
                    org_name_map=org_name_map,
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
                    db,
                    order,
                    override,
                    order_source,
                    skipped_by_reason,
                    errors,
                    do_commit=True,
                    excluded_room_ids=excluded_room_ids,
                    org_name_map=org_name_map,
                )
                created += c
                updated += u
                skipped += s

    label = (order_source or "smartup").strip() or "smartup"
    preview_reason = (
        label in ("diller", "orikzor")
        or len(orders_list) <= 30
        or (len(orders_list) > 0 and created == 0 and updated == 0)
    )
    if orders_list and preview_reason:
        for i, order in enumerate(orders_list[:5]):
            ext = _resolve_external_id(order)
            logger.info(
                "import_orders preview [%s] source=%s: external_id=%s order_no=%s status=%s "
                "to_filial=%s filial_id=%s lines=%s",
                i,
                label,
                ext,
                order.order_no,
                order.status,
                getattr(order, "to_filial_code", None),
                order.filial_id,
                len(order.lines) if order.lines else 0,
            )

    skipped_breakdown = {k: v for k, v in skipped_by_reason.items() if v}
    if skipped_breakdown:
        logger.info("import_orders skipped_by_reason source=%s: %s", label, skipped_breakdown)

    logger.info(
        "import_orders done source=%s: created=%s updated=%s skipped=%s errors=%s batch_size=%s in=%s",
        label,
        created,
        updated,
        skipped,
        len(errors),
        batch_size,
        len(orders_list),
    )
    return created, updated, skipped, errors, skipped_by_reason


def _line_key(line: OrderLine) -> Tuple[str, str, str, str, str]:
    """
    Upsert kaliti. SmartUp `product_unit_id` -> SmartupOrderLine.uom -> OrderLine.uom;
    bir xil SKU/barcode/nomdagi asosiy qator (order_products) va aksiya (order_actions) alohida saqlanadi.
    """
    return (
        (line.sku or "").strip(),
        (line.barcode or "").strip(),
        (line.name or "").strip(),
        (line.uom or "").strip(),
        (line.line_source or "product").strip(),
    )


def _payload_key(payload_line: OrderLinePayload) -> Tuple[str, str, str, str, str]:
    return (
        (payload_line.sku or "").strip(),
        (payload_line.barcode or "").strip(),
        (payload_line.name or "").strip(),
        (payload_line.uom or "").strip(),
        (payload_line.line_source or "product").strip(),
    )


def _normalize_decimalish(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        raw = value.strip().replace(" ", "").replace(",", ".")
        if not raw:
            return ""
        try:
            return format(Decimal(raw).normalize(), "f")
        except InvalidOperation:
            return raw
    if isinstance(value, (int, float, Decimal)):
        return format(Decimal(str(value)).normalize(), "f")
    return str(value).strip()


def _line_price_token(raw_json: dict | None) -> str:
    if not isinstance(raw_json, dict):
        return ""
    for key in ("price", "sale_price", "unit_price", "item_price"):
        if key in raw_json:
            return _normalize_decimalish(raw_json.get(key))
    return ""


def _order_lines_fingerprint_from_order(order: Order) -> List[Tuple[str, str, str, str, str, str]]:
    return sorted(
        (
            (line.sku or "").strip(),
            (line.barcode or "").strip(),
            (line.name or "").strip(),
            _normalize_decimalish(line.qty),
            (line.uom or "").strip(),
            _line_price_token(line.raw_json),
        )
        for line in order.lines
    )


def _order_lines_fingerprint_from_payload(
    payload_lines: List[OrderLinePayload],
) -> List[Tuple[str, str, str, str, str, str]]:
    return sorted(
        (
            (line.sku or "").strip(),
            (line.barcode or "").strip(),
            (line.name or "").strip(),
            _normalize_decimalish(line.qty),
            (line.uom or "").strip(),
            _line_price_token(line.raw_json),
        )
        for line in payload_lines
    )


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
            line.line_source = payload.line_source
            line.raw_json = payload.raw_json
            continue
        order.lines.append(
            OrderLine(
                sku=payload.sku,
                barcode=payload.barcode,
                name=payload.name,
                qty=payload.qty,
                uom=payload.uom,
                line_source=payload.line_source,
                raw_json=payload.raw_json,
            )
        )

    for line in list(order.lines):
        if _line_key(line) not in incoming_keys:
            order.lines.remove(line)
