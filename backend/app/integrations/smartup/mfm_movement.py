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
from app.integrations.smartup.schemas import SmartupOrder, SmartupOrderExportResponse


logger = logging.getLogger(__name__)

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
    Postman / SmartUp UI odatda begin_created_on/end_created_on ni bo'sh qoldirib,
    faqat begin_modified_on/end_modified_on bilan filtrlashadi.
    Default: bo'sh (Postman bilan bir xil). Eski xatti-harakat: SMARTUP_MFM_EXPORT_FILL_CREATED_RANGE=true
    """
    v = (os.getenv("SMARTUP_MFM_EXPORT_FILL_CREATED_RANGE") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _mfm_row_matches_export_status(row: dict) -> bool:
    """
    SmartUp qatorini saqlashdan oldin tekshirish.
    status maydoni bo'lmasa yoki bo'sh bo'lsa — True (API so'rovidagi status filtriga ishonamiz);
    aks holda faqat SMARTUP_MFM_MOVEMENT_EXPORT_STATUS ga mos qatorlar.
    """
    want = _mfm_export_request_status().strip().upper()
    if not want:
        return True
    raw = row.get("status")
    if raw is None or str(raw).strip() == "":
        return True
    got = str(raw).strip().upper()
    return got == want


def _normalize_movement_row_status(raw: Any) -> str:
    if raw is None:
        return normalize_order_wms_status_for_storage(None)
    return normalize_order_wms_status_for_storage(str(raw).strip())

DEFAULT_MFM_URL = "https://smartup.online/b/anor/mxsx/mfm/movement$export"


def resolve_movement_export_date_range(
    begin: date | None,
    end: date | None,
) -> tuple[date, date]:
    """
    SmartUp movement$export uchun sana oralig'i.
    GET /movements bilan bir xil: ikkalasi ham bo'sh bo'lsa — bugundan 30 kun oldingi.
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


def _extract_rows_list(data: Any) -> list | None:
    """Extract list of rows from API response (dict or list)."""
    if isinstance(data, list) and data:
        return data
    if not isinstance(data, dict):
        return None
    for key in (
        "movement",
        "movements",
        "Movement",
        "MovementList",
        "data",
        "items",
        "result",
        "response",
        "export",
        "list",
        "rows",
    ):
        raw = data.get(key)
        if isinstance(raw, list) and raw:
            return raw
    return None


def _parse_mfm_response(body: str) -> SmartupOrderExportResponse:
    """
    Parse mfm movement$export response into SmartupOrderExportResponse.
    Handles both: (1) movement-level objects with movement_items, (2) flat rows with movement_unit_id/product_code.
    """
    data = json.loads(body)
    rows = _extract_rows_list(data)
    if not rows:
        logger.warning("mfm movement$export: javobda ro'yxat topilmadi (body_len=%s)", len(body))
        return SmartupOrderExportResponse(items=[])

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
        skip_status = skip_no_gid = non_dict = 0
        for r in rows:
            if not isinstance(r, dict):
                non_dict += 1
                continue
            if not _mfm_row_matches_export_status(r):
                skip_status += 1
                continue
            gid = (
                str(r.get("movement_id") or r.get("movement_number") or r.get("load_id") or "")
            ).strip() or str(r.get("movement_unit_id") or "")
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
            order_dict = {
                "external_id": external_id or f"mfm:{group_id}",
                "deal_id": group_id,
                "order_no": group_id,
                "status": "imported",
                "filial_id": filial,
                "filial_code": filial,
                "lines": lines,
            }
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
                "skip_row_status": skip_status,
                "skip_row_no_gid": skip_no_gid,
                "skip_non_dict": non_dict,
                "skip_empty_lines_group": skip_empty_lines,
                "validation_failed": validation_failed,
                "want_status": _mfm_export_request_status(),
                "send_status_in_body": str(_mfm_send_status_in_export_body()),
            }
        )
        logger.info("mfm movement$export: %s ta guruh -> %s ta order (flat)", len(groups), len(orders))
    else:
        # Movement-level: movement_id, movement_items, from_warehouse_code, to_warehouse_code, note (sklad-sklad)
        default_filial = (os.getenv("DEFAULT_WAREHOUSE_CODE") or os.getenv("SMARTUP_DEFAULT_FILIAL") or "MAIN").strip()
        skip_status = skip_no_mid = non_dict = validation_failed = 0
        for m in rows:
            if not isinstance(m, dict):
                non_dict += 1
                continue
            if not _mfm_row_matches_export_status(m):
                skip_status += 1
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
                "skip_row_status": skip_status,
                "skip_row_no_movement_id": skip_no_mid,
                "skip_non_dict": non_dict,
                "validation_failed": validation_failed,
                "want_status": _mfm_export_request_status(),
                "send_status_in_body": str(_mfm_send_status_in_export_body()),
            }
        )
        logger.info("mfm movement$export: %s ta order (movement-level)", len(orders))

    parse_summary["orders_out"] = len(orders)
    logger.info("mfm movement$export parse summary: %s", parse_summary)
    logger.info("mfm movement$export parse: smartup_orders_out=%s", len(orders))
    return SmartupOrderExportResponse(items=orders)


def _request_mfm_export(
    begin_date: date,
    end_date: date,
    filial_id: str | None = None,
    begin_modified_on: date | None = None,
    end_modified_on: date | None = None,
) -> str:
    """
    Call SmartUp mfm movement$export, return raw response body (JSON string).
    begin_modified_on/end_modified_on berilsa faqat o'sha vaqtda o'zgartirilgan yozuvlar so'raladi (delta sync).
    """
    url = (os.getenv("SMARTUP_MFM_MOVEMENT_EXPORT_URL") or DEFAULT_MFM_URL).strip()
    project_code = (os.getenv("SMARTUP_PROJECT_CODE") or "trade").strip()
    header_filial = (filial_id or os.getenv("SMARTUP_FILIAL_ID") or "3788131").strip()
    username = (os.getenv("SMARTUP_BASIC_USER") or "").strip() or None
    password = (os.getenv("SMARTUP_BASIC_PASS") or "").strip() or None
    if not username or not password:
        raise RuntimeError(
            "Cross-organizational movement sync uchun SMARTUP_BASIC_USER va SMARTUP_BASIC_PASS ni to'ldiring."
        )

    begin_str = begin_date.strftime("%d.%m.%Y")
    end_str = end_date.strftime("%d.%m.%Y")
    mod_begin = begin_modified_on.strftime("%d.%m.%Y") if begin_modified_on else begin_str
    mod_end = end_modified_on.strftime("%d.%m.%Y") if end_modified_on else end_str
    if _mfm_export_fill_created_date_range():
        created_begin = begin_str
        created_end = end_str
    else:
        # Postman namunasiga mos: yaratilgan sana filtri yo'q, faqat modified oralig'i
        created_begin = ""
        created_end = ""
    payload: dict[str, Any] = {
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

    logger.info(
        "mfm movement$export: url=%s modified_on=%s..%s created_on_filled=%s send_status_in_body=%s status_value=%s",
        url.split("?")[0],
        mod_begin,
        mod_end,
        _mfm_export_fill_created_date_range(),
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
    )
    return json.loads(body)


def export_mfm_movements(
    begin_date: date,
    end_date: date,
    filial_id: str | None = None,
    begin_modified_on: date | None = None,
    end_modified_on: date | None = None,
) -> SmartupOrderExportResponse:
    """
    Call SmartUp mfm movement$export (Cross-organizational movement), return SmartupOrder list.
    """
    body = _request_mfm_export(
        begin_date=begin_date,
        end_date=end_date,
        filial_id=filial_id,
        begin_modified_on=begin_modified_on,
        end_modified_on=end_modified_on,
    )
    logger.info("export_mfm_movements: HTTP body_len=%s", len(body))
    return _parse_mfm_response(body)
