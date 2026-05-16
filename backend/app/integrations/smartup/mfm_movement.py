"""Cross-organizational movement (mfm) export: SmartUp mfm/movement$export API."""

from __future__ import annotations

import base64
import json
import logging
import os
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from pydantic import ValidationError as PydanticValidationError

from app.constants.order_wms_status import normalize_order_wms_status_for_storage
from app.integrations.smartup.movement_rows import extract_movement_rows, movement_delivery_datetime
from app.integrations.smartup.schemas import SmartupOrder, SmartupOrderExportResponse, SmartupOrderLine


logger = logging.getLogger(__name__)

_last_mfm_export_meta: dict[str, Any] = {}


def get_last_mfm_export_meta() -> dict[str, Any]:
    return dict(_last_mfm_export_meta)


def mfm_resolved_filial_id(filial_override: str | None = None) -> str:
    return (filial_override or os.getenv("SMARTUP_FILIAL_ID") or "3788131").strip()


def mfm_resolved_project_code() -> str:
    return (os.getenv("SMARTUP_PROJECT_CODE") or "trade").strip()

DEFAULT_MFM_EXPORT_STATUS = "W"


def _mfm_export_request_status() -> str:
    """SmartUp mfm/movement$export body uchun status (default: W — yangi)."""
    s = (os.getenv("SMARTUP_MFM_MOVEMENT_EXPORT_STATUS") or DEFAULT_MFM_EXPORT_STATUS).strip()
    return s if s else DEFAULT_MFM_EXPORT_STATUS


def _mfm_send_status_in_export_body() -> bool:
    """
    Ba'zi SmartUp versiyalari JSON da \"status\" kaliti bo'lsa bo'sh ro'yxat qaytaradi.
    Default: yuborilmaydi. Yoqish: SMARTUP_MFM_MOVEMENT_EXPORT_SEND_STATUS=true
    """
    v = (os.getenv("SMARTUP_MFM_MOVEMENT_EXPORT_SEND_STATUS") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _mfm_export_fill_created_date_range() -> bool:
    """
    begin_created_on/end_created_on ni body ga yozish (kamdan-kam).
    Default: bo'sh. Yoqish: SMARTUP_MFM_EXPORT_FILL_CREATED_RANGE=true
    """
    v = (os.getenv("SMARTUP_MFM_EXPORT_FILL_CREATED_RANGE") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def mfm_date_filter_mode() -> str:
    """
    mfm/movement$export sanalar qaysi maydonga yoziladi.
    modified — begin_modified_on/end_modified_on (default).
    created — faqat begin_created_on/end_created_on; modified bo'sh qator.
    both — ikkala juft ham bir xil DD.MM.YYYY oralig'i (sinov).
    SMARTUP_MFM_DATE_FILTER_MODE
    """
    v = (os.getenv("SMARTUP_MFM_DATE_FILTER_MODE") or "modified").strip().lower()
    if v in ("created", "both", "modified"):
        return v
    return "modified"


def _mfm_movement_export_omit_dates() -> bool:
    """
    True bo'lsa begin_* / end_* sanalari bo'sh yuboriladi (ba'zi SmartUp konfiguratsiyalari bo'sh javob berishi mumkin).
    Default: False — begin_modified_on/end_modified_on bilan filtr (ishonchliroq).
    Yoqish: SMARTUP_MFM_MOVEMENT_EXPORT_OMIT_DATES=true
    """
    v = (os.getenv("SMARTUP_MFM_MOVEMENT_EXPORT_OMIT_DATES") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _mfm_flat_row_group_keys() -> tuple[str, ...]:
    """
    Flat export: qatorlarni qaysi maydon bo'yicha guruhlash.
    SMARTUP_MFM_FLAT_GROUP_BY_KEYS=delivery_number,external_id,movement_id,... (vergul bilan).
    Bir harakat bir nechta ichki movement_id bilan kelsa — delivery_number birinchi qo'yish mumkin.
    """
    raw = (os.getenv("SMARTUP_MFM_FLAT_GROUP_BY_KEYS") or "").strip()
    if raw:
        return tuple(k.strip() for k in raw.split(",") if k.strip())
    return (
        "movement_id",
        "movement_number",
        "load_id",
        "external_id",
        "delivery_number",
        "deliveryNumber",
        "deal_id",
        "order_id",
        "movement_unit_id",
    )


def _flat_row_group_id(r: dict) -> str:
    for key in _mfm_flat_row_group_keys():
        v = str(r.get(key) or "").strip()
        if v:
            return v
    return ""


def _dedupe_mfm_orders_by_external_id(orders: list[SmartupOrder]) -> list[SmartupOrder]:
    """Bir xil import kaliti (external_id) takrorlansa — bitta SmartupOrder, qatorlar qo'shiladi."""
    from collections import OrderedDict

    from app.integrations.smartup.mapper import _resolve_external_id

    buckets: OrderedDict[str, list[SmartupOrder]] = OrderedDict()
    for o in orders:
        buckets.setdefault(_resolve_external_id(o), []).append(o)
    out: list[SmartupOrder] = []
    merged_extra = 0
    for grp in buckets.values():
        if len(grp) == 1:
            out.append(grp[0])
            continue
        merged_extra += len(grp) - 1
        base = grp[0]
        by_sku: dict[str, SmartupOrderLine] = {}
        for o in grp:
            for ln in o.lines:
                sku = (ln.sku or "").strip() or "__empty__"
                if sku in by_sku:
                    prev = by_sku[sku]
                    by_sku[sku] = prev.model_copy(update={"qty": (prev.qty or 0) + (ln.qty or 0)})
                else:
                    by_sku[sku] = ln
        bd = base.model_dump()
        bd["lines"] = [x.model_dump() for x in by_sku.values()]
        out.append(SmartupOrder.model_validate(bd))
    if merged_extra:
        logger.info(
            "mfm movement$export: bir xil external_id uchun %s ta takror buyurtma bitta qatorga yig'ildi",
            merged_extra,
        )
    return out


def _normalize_movement_row_status(raw: Any) -> str:
    """SmartUp qatorida status bo'lmasa — eksport so'rovidagi default (odatda W)."""
    if raw is None or str(raw).strip() == "":
        return _mfm_export_request_status()
    normalized = normalize_order_wms_status_for_storage(str(raw).strip())
    # B#W/B#S asosiy buyurtmada imported; mfm tashkiliy harakatda yangi = W
    if normalized == "imported":
        return _mfm_export_request_status()
    return normalized

DEFAULT_MFM_URL = "https://smartup.online/b/anor/mxsx/mfm/movement$export"


def resolve_movement_export_date_range(
    begin: date | None,
    end: date | None,
) -> tuple[date, date]:
    """
    SmartUp movement exportlari uchun sana oralig'i (mfm va mkw).
    Ikkala sana ham bo'sh bo'lsa — bugundan 30 kun oldingi.
    """
    today = date.today()
    if begin is None and end is None:
        return today - timedelta(days=30), today
    if begin is None:
        assert end is not None
        return end - timedelta(days=30), end
    if end is None:
        return begin, begin + timedelta(days=30)
    return begin, end


def mfm_sync_lookback_days() -> int:
    """MFM modified_on uchun default kunlar (min 14, max 730)."""
    raw = (os.getenv("SMARTUP_MFM_SYNC_LOOKBACK_DAYS") or "120").strip()
    try:
        return max(14, min(int(raw), 730))
    except ValueError:
        return 120


def resolve_mfm_sync_date_range(
    begin: date | None,
    end: date | None,
) -> tuple[date, date]:
    """
    mfm/movement$export uchun sana oralig'i (asosan modified_on).
    Ikkala sana bo'sh bo'lsa — bugundan mfm_sync_lookback_days() kun oldingi.
    """
    today = date.today()
    lb = mfm_sync_lookback_days()
    if begin is None and end is None:
        return today - timedelta(days=lb), today
    if begin is None:
        assert end is not None
        return end - timedelta(days=lb), end
    if end is None:
        return begin, begin + timedelta(days=lb)
    return begin, end


def apply_mfm_export_date_policy(begin: date, end: date) -> tuple[date, date]:
    """
    Diller HTTP sinxron: juda eski end uchun default oralik;
    juda qisqa modified oralig'ini kengaytirish (30 kun ichida tahrir bo'lmasa 0 qator).
    """
    today = date.today()
    if (today - end).days > 365:
        return resolve_mfm_sync_date_range(None, None)
    lb = mfm_sync_lookback_days()
    if (end - begin).days < 60:
        min_begin = end - timedelta(days=lb)
        if begin > min_begin:
            logger.info(
                "mfm export date policy: modified_on oralig'i %s..%s dan %s..%s ga kengaytirildi (lb=%s kun)",
                begin,
                end,
                min_begin,
                end,
                lb,
            )
            begin = min_begin
    return begin, end


def _parse_mfm_response(body: str) -> SmartupOrderExportResponse:
    """
    Parse mfm movement$export response into SmartupOrderExportResponse.
    Handles both: (1) movement-level objects with movement_items, (2) flat rows with movement_unit_id/product_code.
    """
    global _last_mfm_export_meta
    data = json.loads(body)
    rows, extract_source = extract_movement_rows(data)
    keys = list(data.keys()) if isinstance(data, dict) else []
    _last_mfm_export_meta = {
        "http_body_len": len(body),
        "raw_keys": keys,
        "extracted_rows": len(rows),
        "extract_source": extract_source,
    }
    if not rows:
        preview = (body[:500] if body else "").replace("\n", " ")
        logger.warning(
            "mfm movement$export: javobda ro'yxat topilmadi (body_len=%s keys=%s extract_source=%s preview=%s)",
            len(body),
            keys,
            extract_source,
            preview,
        )
        return SmartupOrderExportResponse(order=[])

    first = rows[0] if rows else {}
    # Flat rows: each item has movement_unit_id, product_code (no nested movement_items)
    is_flat = (
        isinstance(first, dict)
        and (first.get("movement_unit_id") is not None or first.get("product_code") is not None)
        and not (first.get("movement_items") or first.get("movement_itens") or first.get("movementItems"))
    )
    logger.info(
        "mfm movement$export parse: body_len=%s extracted_rows=%s is_flat=%s",
        len(body),
        len(rows),
        is_flat,
    )

    orders: list[SmartupOrder] = []
    parse_summary: dict[str, int | bool | str] = {"is_flat": is_flat, "raw_rows": len(rows)}
    if is_flat:
        # Group by movement_id or load_id
        groups: dict[str, list[dict]] = defaultdict(list)
        skip_no_gid = non_dict = 0
        for r in rows:
            if not isinstance(r, dict):
                non_dict += 1
                continue
            gid = _flat_row_group_id(r)
            if not gid:
                skip_no_gid += 1
                continue
            groups[gid].append(r)

        default_filial = (os.getenv("DEFAULT_WAREHOUSE_CODE") or os.getenv("SMARTUP_DEFAULT_FILIAL") or "MAIN").strip()
        skip_empty_lines = validation_failed = 0
        for group_id, unit_rows in groups.items():
            lines = []
            filial = default_filial
            external_id = ""
            for u in unit_rows:
                try:
                    qty = float(u.get("quantity") or u.get("qty") or 0)
                except (TypeError, ValueError):
                    qty = 0
                pc = u.get("product_code") or u.get("productCode") or ""
                if pc or qty:
                    lines.append({
                        "product_code": pc,
                        "sku": pc,
                        "quantity": qty,
                        "name": u.get("product_article_code") or u.get("productArticleCode") or pc or "",
                    })
                fid = u.get("filial_code") or u.get("from_warehouse_code") or u.get("to_warehouse_code")
                if fid and str(fid).strip():
                    filial = str(fid).strip()
                ext = (u.get("external_id") or "").strip()
                if ext:
                    external_id = ext
            if not lines:
                skip_empty_lines += 1
                continue
            delivery_dt = None
            for u in unit_rows:
                delivery_dt = movement_delivery_datetime(u)
                if delivery_dt is not None:
                    break
            dn_row = ""
            for u in unit_rows:
                dn_row = str(u.get("delivery_number") or u.get("deliveryNumber") or "").strip()
                if dn_row:
                    break
            order_dict = {
                "external_id": external_id or f"mfm:{group_id}",
                "deal_id": group_id,
                "order_no": group_id,
                "status": _mfm_export_request_status(),
                "filial_id": filial,
                "filial_code": filial,
                "lines": lines,
            }
            if dn_row:
                order_dict["delivery_number"] = dn_row[:64]
            if delivery_dt is not None:
                order_dict["delivery_date"] = delivery_dt
            try:
                orders.append(SmartupOrder.model_validate(order_dict))
            except PydanticValidationError as exc:
                validation_failed += 1
                logger.warning("mfm movement to order skip group_id=%s: %s", group_id, exc)
            except Exception as exc:  # noqa: BLE001
                validation_failed += 1
                logger.warning("mfm movement to order skip group_id=%s: %s", group_id, exc)
        parse_summary.update(
            {
                "groups": len(groups),
                "skip_row_no_gid": skip_no_gid,
                "skip_non_dict": non_dict,
                "skip_empty_lines_group": skip_empty_lines,
                "validation_failed": validation_failed,
                "want_status": _mfm_export_request_status(),
                "send_status_in_body": str(_mfm_send_status_in_export_body()),
                "flat_group_key_order": ",".join(_mfm_flat_row_group_keys()),
            }
        )
        logger.info("mfm movement$export: %s ta guruh -> %s ta order (flat)", len(groups), len(orders))
    else:
        # Movement-level: movement_id, movement_items, from_warehouse_code, to_warehouse_code, note (sklad-sklad)
        default_filial = (os.getenv("DEFAULT_WAREHOUSE_CODE") or os.getenv("SMARTUP_DEFAULT_FILIAL") or "MAIN").strip()
        skip_no_mid = non_dict = validation_failed = 0
        for m in rows:
            if not isinstance(m, dict):
                non_dict += 1
                continue
            movement_id = (m.get("movement_id") or m.get("movement_number") or "").strip()
            if not movement_id:
                skip_no_mid += 1
                continue
            items = m.get("movement_items") or m.get("movement_itens") or m.get("movementItems") or []
            if not isinstance(items, list):
                items = [items] if items else []
            lines = []
            for it in items:
                if not isinstance(it, dict):
                    continue
                try:
                    qty = float(it.get("quantity") or it.get("qty") or 0)
                except (TypeError, ValueError):
                    qty = 0
                pc = it.get("product_code") or it.get("productCode") or ""
                lines.append({
                    "product_code": pc,
                    "sku": pc,
                    "quantity": qty,
                    "name": it.get("product_article_code") or it.get("productArticleCode") or pc or "",
                })
            from_wh = (m.get("from_warehouse_code") or "").strip() or None
            to_wh = (m.get("to_warehouse_code") or "").strip() or None
            note = (m.get("note") or "").strip() or None
            filial = from_wh or to_wh or default_filial
            amount = m.get("amount")
            if amount is not None and amount != "":
                try:
                    amount = str(amount).replace(" ", "").replace(",", ".")
                except Exception:
                    amount = None
            delivery_dt = movement_delivery_datetime(m)
            order_dict = {
                "external_id": (m.get("external_id") or "").strip() or f"mfm:{movement_id}",
                "deal_id": movement_id,
                "order_no": (m.get("delivery_number") or m.get("movement_number") or movement_id) or movement_id,
                "status": _normalize_movement_row_status(m.get("status")),
                "filial_id": filial,
                "filial_code": filial,
                "total_amount": amount,
                "from_warehouse_code": from_wh,
                "to_warehouse_code": to_wh,
                "note": note,
                "lines": lines,
            }
            dn_m = str(m.get("delivery_number") or m.get("deliveryNumber") or "").strip()
            if dn_m:
                order_dict["delivery_number"] = dn_m[:64]
            if delivery_dt is not None:
                order_dict["delivery_date"] = delivery_dt
            try:
                orders.append(SmartupOrder.model_validate(order_dict))
            except PydanticValidationError as exc:
                validation_failed += 1
                logger.warning("mfm movement skip movement_id=%s: %s", movement_id, exc)
            except Exception as exc:  # noqa: BLE001
                validation_failed += 1
                logger.warning("mfm movement skip movement_id=%s: %s", movement_id, exc)
        parse_summary.update(
            {
                "skip_row_no_movement_id": skip_no_mid,
                "skip_non_dict": non_dict,
                "validation_failed": validation_failed,
                "want_status": _mfm_export_request_status(),
                "send_status_in_body": str(_mfm_send_status_in_export_body()),
            }
        )
        logger.info("mfm movement$export: %s ta order (movement-level)", len(orders))

    orders = _dedupe_mfm_orders_by_external_id(orders)
    parse_summary["orders_out"] = len(orders)
    _last_mfm_export_meta["orders_parsed"] = len(orders)
    logger.info("mfm movement$export parse summary: %s", parse_summary)
    logger.info("mfm movement$export parse: smartup_orders_out=%s", len(orders))
    logging.getLogger("uvicorn").info("WMS mfm parse: %s", parse_summary)
    response = SmartupOrderExportResponse(order=orders)
    if orders and not response.items:
        logger.error(
            "mfm movement$export: parse %s order lekin response.items bo'sh (alias); qayta yig'ilmoqda",
            len(orders),
        )
        response = SmartupOrderExportResponse(order=orders)
    return response


def _request_mfm_export(
    begin_date: date,
    end_date: date,
    filial_id: str | None = None,
    begin_modified_on: date | None = None,
    end_modified_on: date | None = None,
    date_filter_mode_override: str | None = None,
) -> str:
    """
    Call SmartUp mfm movement$export, return raw response body (JSON string).
    begin_modified_on/end_modified_on berilsa faqat o'sha vaqtda o'zgartirilgan yozuvlar so'raladi (delta sync).
    SMARTUP_MFM_MOVEMENT_EXPORT_OMIT_DATES=true bo'lsa barcha sana maydonlari bo'sh (ba'zi serverlar bo'sh javob beradi).
    """
    url = (os.getenv("SMARTUP_MFM_MOVEMENT_EXPORT_URL") or DEFAULT_MFM_URL).strip()
    header_filial = mfm_resolved_filial_id(filial_id)
    project_code = mfm_resolved_project_code()
    _last_mfm_export_meta["request_filial_id"] = header_filial
    _last_mfm_export_meta["request_project_code"] = project_code
    username = (os.getenv("SMARTUP_BASIC_USER") or "").strip() or None
    password = (os.getenv("SMARTUP_BASIC_PASS") or "").strip() or None
    if not username or not password:
        raise RuntimeError(
            "Cross-organizational movement sync uchun SMARTUP_BASIC_USER va SMARTUP_BASIC_PASS ni to'ldiring."
        )

    if _mfm_movement_export_omit_dates():
        payload: dict[str, Any] = {
            "filial_codes": [{"filial_code": ""}],
            "filial_code": "",
            "external_id": "",
            "movement_id": "",
            "begin_created_on": "",
            "end_created_on": "",
            "begin_modified_on": "",
            "end_modified_on": "",
        }
        mod_begin = mod_end = created_begin = created_end = ""
    else:
        begin_str = begin_date.strftime("%d.%m.%Y")
        end_str = end_date.strftime("%d.%m.%Y")
        mode = (date_filter_mode_override or mfm_date_filter_mode()).strip().lower()
        if mode not in ("created", "both", "modified"):
            mode = "modified"
        if mode == "created":
            created_begin, created_end = begin_str, end_str
            mod_begin = ""
            mod_end = ""
        elif mode == "both":
            created_begin, created_end = begin_str, end_str
            mod_begin = begin_modified_on.strftime("%d.%m.%Y") if begin_modified_on else begin_str
            mod_end = end_modified_on.strftime("%d.%m.%Y") if end_modified_on else end_str
        else:
            mod_begin = begin_modified_on.strftime("%d.%m.%Y") if begin_modified_on else begin_str
            mod_end = end_modified_on.strftime("%d.%m.%Y") if end_modified_on else end_str
            if _mfm_export_fill_created_date_range():
                created_begin = begin_str
                created_end = end_str
            else:
                created_begin = ""
                created_end = ""
        payload = {
            "filial_codes": [{"filial_code": ""}],
            "filial_code": "",
            "external_id": "",
            "movement_id": "",
            "begin_created_on": created_begin,
            "end_created_on": created_end,
            "begin_modified_on": mod_begin,
            "end_modified_on": mod_end,
        }
    if _mfm_send_status_in_export_body():
        payload["status"] = _mfm_export_request_status()
    data = json.dumps(payload).encode("utf-8")
    credentials = f"{username}:{password}"
    basic_token = base64.b64encode(credentials.encode("utf-8")).decode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Basic {basic_token}",
        "project_code": project_code,
        "filial_id": header_filial,
    }

    effective_mode = (
        "omit"
        if _mfm_movement_export_omit_dates()
        else (date_filter_mode_override or mfm_date_filter_mode())
    )
    logger.info(
        "mfm movement$export: url=%s omit_dates=%s date_mode=%s created_on=%s..%s modified_on=%s..%s send_status_in_body=%s status_value=%s",
        url.split("?")[0],
        _mfm_movement_export_omit_dates(),
        effective_mode,
        created_begin,
        created_end,
        mod_begin,
        mod_end,
        _mfm_send_status_in_export_body(),
        _mfm_export_request_status() if _mfm_send_status_in_export_body() else "-",
    )

    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        response_text = exc.read().decode("utf-8")
        logger.error("mfm movement$export HTTP %s: %s", exc.code, response_text)
        hint = ""
        if exc.code in (401, 481):
            hint = " SMARTUP_BASIC_USER, SMARTUP_BASIC_PASS, SMARTUP_PROJECT_CODE=trade tekshiring."
        raise RuntimeError(f"Smartup mfm movement$export failed: {response_text}{hint}") from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("mfm movement$export: %s", exc)
        raise RuntimeError(f"Smartup mfm movement$export failed: {exc}") from exc


def fetch_mfm_movements_raw(
    begin_date: date,
    end_date: date,
    filial_id: str | None = None,
    begin_modified_on: date | None = None,
    end_modified_on: date | None = None,
    date_filter_mode_override: str | None = None,
) -> dict:
    """
    Call SmartUp mfm movement$export and return raw JSON as dict (e.g. {"movement": [...]}).
    begin_modified_on/end_modified_on orqali delta sync (faqat o'zgarishlar) qilish mumkin.
    """
    body = _request_mfm_export(
        begin_date=begin_date,
        end_date=end_date,
        filial_id=filial_id,
        begin_modified_on=begin_modified_on,
        end_modified_on=end_modified_on,
        date_filter_mode_override=date_filter_mode_override,
    )
    return json.loads(body)


def export_mfm_movements(
    begin_date: date,
    end_date: date,
    filial_id: str | None = None,
    begin_modified_on: date | None = None,
    end_modified_on: date | None = None,
    date_filter_mode_override: str | None = None,
) -> SmartupOrderExportResponse:
    """
    Call SmartUp mfm movement$export (Cross-organizational movement), return SmartupOrder list.
    """
    mode_used = date_filter_mode_override or mfm_date_filter_mode()
    body = _request_mfm_export(
        begin_date=begin_date,
        end_date=end_date,
        filial_id=filial_id,
        begin_modified_on=begin_modified_on,
        end_modified_on=end_modified_on,
        date_filter_mode_override=date_filter_mode_override,
    )
    logger.info("export_mfm_movements: HTTP body_len=%s date_mode=%s", len(body), mode_used)
    result = _parse_mfm_response(body)
    _last_mfm_export_meta.update(
        {"date_filter_mode": mode_used, "orders_parsed": len(result.items)}
    )
    return result


def export_mfm_movements_for_sync(
    begin_date: date,
    end_date: date,
    filial_id: str | None = None,
) -> tuple[SmartupOrderExportResponse, str]:
    """
    Diller sinxron: bo'sh javobda created va both rejimlarida qayta urinadi.
    Qaytadi: (response, effective_date_filter_mode).
    """
    if _mfm_movement_export_omit_dates():
        response = export_mfm_movements(begin_date, end_date, filial_id=filial_id)
        return response, "omit"

    configured = mfm_date_filter_mode()
    modes_to_try: list[str] = []
    for candidate in (configured, "created", "both"):
        if candidate not in modes_to_try:
            modes_to_try.append(candidate)

    attempts: list[dict[str, Any]] = []
    last_response = SmartupOrderExportResponse(order=[])
    effective_mode = configured

    for try_mode in modes_to_try:
        override = try_mode if try_mode != configured else None
        logger.info("mfm export for_sync: attempt mode=%s", try_mode)
        last_response = export_mfm_movements(
            begin_date,
            end_date,
            filial_id=filial_id,
            date_filter_mode_override=override,
        )
        meta = get_last_mfm_export_meta()
        attempts.append(
            {
                "mode": try_mode,
                "extracted_rows": meta.get("extracted_rows"),
                "orders_parsed": len(last_response.items),
                "http_body_len": meta.get("http_body_len"),
                "raw_keys": meta.get("raw_keys"),
            }
        )
        effective_mode = try_mode
        if last_response.items:
            _last_mfm_export_meta["sync_attempts"] = attempts
            _last_mfm_export_meta["date_filter_mode"] = try_mode
            return last_response, try_mode

    _last_mfm_export_meta["sync_attempts"] = attempts
    logger.warning(
        "mfm export for_sync: barcha rejimlarda 0 order (attempts=%s filial=%s project=%s)",
        attempts,
        mfm_resolved_filial_id(filial_id),
        mfm_resolved_project_code(),
    )
    return last_response, effective_mode
