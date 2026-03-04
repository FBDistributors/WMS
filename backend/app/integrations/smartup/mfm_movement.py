"""Cross-organizational movement (mfm) export: SmartUp mfm/movement$export API."""

from __future__ import annotations

import base64
import json
import logging
import os
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date
from typing import Any

from pydantic import ValidationError as PydanticValidationError

from app.integrations.smartup.schemas import SmartupOrder, SmartupOrderExportResponse


logger = logging.getLogger(__name__)

DEFAULT_MFM_URL = "https://smartup.online/b/anor/mxsx/mfm/movement$export"


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
        logger.warning("mfm movement$export: javobda ro'yxat topilmadi")
        return SmartupOrderExportResponse(items=[])

    first = rows[0] if rows else {}
    # Flat rows: each item has movement_unit_id, product_code (no nested movement_items)
    is_flat = (
        isinstance(first, dict)
        and (first.get("movement_unit_id") is not None or first.get("product_code") is not None)
        and not (first.get("movement_items") or first.get("movement_itens") or first.get("movementItems"))
    )

    orders: list[SmartupOrder] = []
    if is_flat:
        # Group by movement_id or load_id
        groups: dict[str, list[dict]] = defaultdict(list)
        for r in rows:
            if not isinstance(r, dict):
                continue
            gid = (
                str(r.get("movement_id") or r.get("movement_number") or r.get("load_id") or "")
            ).strip() or str(r.get("movement_unit_id") or "")
            if not gid:
                continue
            groups[gid].append(r)

        default_filial = (os.getenv("DEFAULT_WAREHOUSE_CODE") or os.getenv("SMARTUP_DEFAULT_FILIAL") or "MAIN").strip()
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
                continue
            order_dict = {
                "external_id": external_id or f"mfm:{group_id}",
                "deal_id": group_id,
                "order_no": group_id,
                "status": "B#S",
                "filial_id": filial,
                "filial_code": filial,
                "lines": lines,
            }
            try:
                orders.append(SmartupOrder.model_validate(order_dict))
            except PydanticValidationError as exc:
                logger.warning("mfm movement to order skip group_id=%s: %s", group_id, exc)
            except Exception as exc:  # noqa: BLE001
                logger.warning("mfm movement to order skip group_id=%s: %s", group_id, exc)
        logger.info("mfm movement$export: %s ta guruh -> %s ta order (flat)", len(groups), len(orders))
    else:
        # Movement-level: movement_id, movement_items, from_warehouse_code, to_warehouse_code, note (sklad-sklad)
        default_filial = (os.getenv("DEFAULT_WAREHOUSE_CODE") or os.getenv("SMARTUP_DEFAULT_FILIAL") or "MAIN").strip()
        for m in rows:
            if not isinstance(m, dict):
                continue
            movement_id = (m.get("movement_id") or m.get("movement_number") or "").strip()
            if not movement_id:
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
                "status": (m.get("status") or "B#S").strip() or "B#S",
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
                logger.warning("mfm movement skip movement_id=%s: %s", movement_id, exc)
            except Exception as exc:  # noqa: BLE001
                logger.warning("mfm movement skip movement_id=%s: %s", movement_id, exc)
        logger.info("mfm movement$export: %s ta order (movement-level)", len(orders))

    return SmartupOrderExportResponse(items=orders)


def _request_mfm_export(
    begin_date: date,
    end_date: date,
    filial_id: str | None = None,
) -> str:
    """
    Call SmartUp mfm movement$export, return raw response body (JSON string).
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
    payload = {
        "filial_codes": [{"filial_code": ""}],
        "filial_code": "",
        "external_id": "",
        "movement_id": "",
        "begin_created_on": begin_str,
        "end_created_on": end_str,
        "begin_modified_on": begin_str,
        "end_modified_on": end_str,
    }
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
        "mfm movement$export: url=%s sana=%s..%s",
        url.split("?")[0],
        begin_str,
        end_str,
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
) -> dict:
    """
    Call SmartUp mfm movement$export and return raw JSON as dict (e.g. {"movement": [...]}).
    Does not parse into SmartupOrder; for use by GET /api/v1/movements.
    """
    body = _request_mfm_export(begin_date=begin_date, end_date=end_date, filial_id=filial_id)
    return json.loads(body)


def export_mfm_movements(
    begin_date: date,
    end_date: date,
    filial_id: str | None = None,
) -> SmartupOrderExportResponse:
    """
    Call SmartUp mfm movement$export (Cross-organizational movement), return SmartupOrder list.
    Uses begin_created_on/end_created_on in payload.
    """
    body = _request_mfm_export(begin_date=begin_date, end_date=end_date, filial_id=filial_id)
    return _parse_mfm_response(body)
