"""O'rikzor harakatlari: Smartup movement$export orqali ichki harakatlarni yuklash."""

from __future__ import annotations

import base64
import json
import logging
import os
import urllib.error
import urllib.request
from datetime import date

from app.integrations.smartup.schemas import SmartupOrder, SmartupOrderExportResponse


logger = logging.getLogger(__name__)


def _parse_movement_response(body: str) -> SmartupOrderExportResponse:
    """movement$export javobini parse qiladi; bitta joyda movement/movements/list va movement_items/itens."""
    data = json.loads(body)
    movements: list = []

    if isinstance(data, list):
        movements = data
    elif isinstance(data, dict):
        if data.get("movement_id") is not None or data.get("movement_number") is not None:
            movements = [data]
        elif isinstance(data.get("movement"), list):
            movements = data["movement"]
        else:
            raw = (
                data.get("movement")
                or data.get("movements")
                or data.get("data")
                or data.get("items")
                or data.get("result")
            )
            if raw is not None:
                if isinstance(raw, list):
                    movements = raw
                elif isinstance(raw, dict):
                    # Bitta movement ob'ekti yoki {"movement": [...]} wrapper
                    if raw.get("movement_id") is not None or raw.get("movement_number") is not None:
                        movements = [raw]
                    else:
                        inner = raw.get("movement") or raw.get("movements")
                        movements = inner if isinstance(inner, list) else [inner] if inner else []
                elif isinstance(raw, str):
                    try:
                        parsed = json.loads(raw)
                        movements = parsed if isinstance(parsed, list) else [parsed] if parsed else []
                    except (TypeError, ValueError, json.JSONDecodeError):
                        movements = []
                else:
                    movements = [raw] if raw else []

    if not isinstance(movements, list):
        movements = [movements] if movements else []

    # String elementlarni parse qilish
    normalized: list = []
    for x in movements:
        if isinstance(x, dict):
            normalized.append(x)
        elif isinstance(x, str):
            try:
                p = json.loads(x)
                normalized.extend(p) if isinstance(p, list) else normalized.append(p)
            except (TypeError, ValueError, json.JSONDecodeError):
                pass
    movements = normalized

    # Wrapper [{"movement": [...]}] yoki har bir element {"movement": {...}} — ichidagi ro'yxatni chiqarish
    expanded: list = []
    for x in movements:
        if isinstance(x, dict) and (
            x.get("movement_id") is not None or x.get("movement_number") is not None
        ):
            expanded.append(x)
        elif isinstance(x, dict):
            inner = x.get("movement") or x.get("movements")
            if isinstance(inner, list):
                expanded.extend(inner)
            elif isinstance(inner, dict):
                expanded.append(inner)
            else:
                expanded.append(x)
        else:
            expanded.append(x)
    # Yana bir qatorda wrapper bo'lsa (har bir element {"movement": {...}})
    flattened: list = []
    for m in expanded:
        if not isinstance(m, dict):
            continue
        if m.get("movement_id") is not None or m.get("movement_number") is not None:
            flattened.append(m)
        else:
            inner = m.get("movement") or m.get("movements")
            if isinstance(inner, list):
                flattened.extend(inner)
            elif isinstance(inner, dict):
                flattened.append(inner)
    movements = [m for m in flattened if isinstance(m, dict)]

    logger.info(
        "Smartup movement$export parse: raw_count=%s dict_count=%s",
        len(expanded),
        len(movements),
    )

    orders: list[SmartupOrder] = []
    for m in movements:
        raw_id = m.get("movement_id")
        raw_num = m.get("movement_number")
        movement_id = (str(raw_id) if raw_id is not None else "").strip() or (str(raw_num) if raw_num is not None else "").strip()
        movement_number = (str(raw_num) if raw_num is not None else str(raw_id) if raw_id is not None else "").strip()
        if not movement_id and not movement_number:
            continue
        movement_id = movement_id or movement_number

        items = m.get("movement_items") or m.get("movement_itens") or []
        if not isinstance(items, list):
            items = [items] if items else []
        item_dicts: list = []
        for it in items:
            if isinstance(it, dict):
                item_dicts.append(it)
            elif isinstance(it, str):
                try:
                    item_dicts.append(json.loads(it))
                except (TypeError, ValueError, json.JSONDecodeError):
                    pass

        lines = []
        for it in item_dicts:
            if not isinstance(it, dict):
                continue
            try:
                qty = float(it.get("quantity") or 0)
            except (TypeError, ValueError):
                qty = 0
            lines.append({
                "product_code": it.get("product_code"),
                "sku": it.get("product_code"),
                "quantity": qty,
                "name": it.get("product_article_code") or it.get("product_code") or "",
            })

        order_dict = {
            "external_id": movement_id,
            "deal_id": movement_id,
            "order_no": movement_number,
            "status": "B#S",
            "filial_id": m.get("filial_code"),
            "filial_code": m.get("filial_code"),
            "lines": lines,
        }
        try:
            validate = getattr(SmartupOrder, "model_validate", getattr(SmartupOrder, "parse_obj", None))
            if validate:
                orders.append(validate(order_dict))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "O'rikzor movement to order skip movement_id=%s reason=%s",
                movement_id,
                exc,
                exc_info=False,
            )

    return SmartupOrderExportResponse(items=orders)


def export_movements_from_smartup(begin_date: date, end_date: date) -> SmartupOrderExportResponse:
    """Smartup movement$export ga so'rov yuborib, harakatlarni SmartupOrder ro'yxati sifatida qaytaradi."""
    url = (
        os.getenv("SMARTUP_ORIKZOR_EXPORT_URL")
        or "https://smartup.online/b/anor/mxsx/mkw/movement$export"
    ).strip()
    project_code = (os.getenv("SMARTUP_PROJECT_CODE") or "trade").strip()
    filial_id = (os.getenv("SMARTUP_FILIAL_ID") or "3788131").strip()
    username = (os.getenv("SMARTUP_BASIC_USER") or "").strip() or None
    password = (os.getenv("SMARTUP_BASIC_PASS") or "").strip() or None
    if not username or not password:
        raise RuntimeError(
            "O'rikzor sync uchun SMARTUP_BASIC_USER va SMARTUP_BASIC_PASS ni to'ldiring."
        )

    begin_str = begin_date.strftime("%d.%m.%Y")
    end_str = end_date.strftime("%d.%m.%Y")
    payload = {
        "filial_codes": [{"filial_code": ""}],
        "filial_code": "",
        "external_id": "",
        "movement_id": "",
        "begin_from_movement_date": begin_str,
        "end_from_movement_date": end_str,
        "begin_to_movement_date": "",
        "end_to_movement_date": "",
        "begin_created_on": "",
        "end_created_on": "",
        "begin_modified_on": "",
        "end_modified_on": "",
    }
    data = json.dumps(payload).encode("utf-8")
    credentials = f"{username}:{password}"
    basic_token = base64.b64encode(credentials.encode("utf-8")).decode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Basic {basic_token}",
        "project_code": project_code,
        "filial_id": filial_id,
    }

    logger.info(
        "Smartup movement$export: url=%s sana=%s..%s",
        url.split("?")[0],
        begin_str,
        end_str,
    )

    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        response_text = exc.read().decode("utf-8")
        logger.error("Smartup movement$export HTTP %s: %s", exc.code, response_text)
        hint = ""
        if exc.code in (401, 481):
            hint = " SMARTUP_BASIC_USER, SMARTUP_BASIC_PASS, SMARTUP_PROJECT_CODE=trade tekshiring."
        raise RuntimeError(f"Smartup movement$export failed: {response_text}{hint}") from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("Smartup movement$export: %s", exc)
        raise RuntimeError(f"Smartup movement$export failed: {exc}") from exc

    parsed = _parse_movement_response(body)
    if parsed.items:
        logger.info("Smartup movement$export: %s ta movement", len(parsed.items))
    else:
        try:
            raw = json.loads(body)
            keys = list(raw.keys()) if isinstance(raw, dict) else []
            logger.warning(
                "Smartup movement$export: 0 ta order. Kalitlar=%s preview=%s",
                keys,
                (body[:500] + "...") if len(body) > 500 else body,
            )
        except Exception:  # noqa: S110
            logger.warning("Smartup movement$export: API dan 0 ta movement qaytdi.")
    return parsed
