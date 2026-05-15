"""SmartUp movement$export javobidan movement qatorlarini chiqarish (MFM va O'rikzor)."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


def flatten_movement_list(lst: list) -> list:
    """Ro'yxat ichida ro'yxat bo'lsa bitta ro'yxatga yoyadi."""
    out: list = []
    for x in lst:
        if isinstance(x, list):
            out.extend(x)
        else:
            out.append(x)
    return out


def is_movement_row_dict(d: Any) -> bool:
    """Movement-level yoki flat export qatori."""
    if not isinstance(d, dict):
        return False
    return (
        d.get("movement_id") is not None
        or d.get("movement_number") is not None
        or d.get("movement_unit_id") is not None
        or d.get("product_code") is not None
        or d.get("productCode") is not None
    )


def parse_movement_date(value: str | int | float | None) -> datetime | None:
    """SmartUp sanalari: DD.MM.YYYY, ISO, Unix timestamp."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            ts = float(value)
            if ts > 1e12:
                ts /= 1000.0
            return datetime.fromtimestamp(ts)
        except (ValueError, OSError):
            return None
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw or raw.lower() in ("none", "null"):
        return None
    formats = (
        "%d.%m.%Y %H:%M:%S",
        "%d.%m.%Y",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y",
    )
    for fmt in formats:
        try:
            return datetime.strptime(raw, fmt)
        except (ValueError, TypeError):
            continue
    return None


def movement_delivery_datetime(row: dict) -> datetime | None:
    """Import/jadval filtri uchun delivery_date manbai."""
    for key in (
        "delivery_date",
        "deliveryDate",
        "from_movement_date",
        "movement_date",
        "deal_time",
        "created_on",
        "createdOn",
        "modified_on",
        "modifiedOn",
    ):
        parsed = parse_movement_date(row.get(key))
        if parsed is not None:
            return parsed
    return None


def extract_movement_rows(data: Any) -> tuple[list[dict], str | None]:
    """
    JSON dan movement qatorlari ro'yxati.
    Qaytadi: (rows, source_hint) — source_hint log uchun (masalan 'movement', 'response.data').
    """
    movements: list = []
    source_hint: str | None = None

    if isinstance(data, list) and data:
        movements = data
        source_hint = "root_list"
    elif isinstance(data, dict):
        if is_movement_row_dict(data):
            movements = [data]
            source_hint = "root_dict"
        elif isinstance(data.get("movement"), list):
            movements = flatten_movement_list(data["movement"])
            source_hint = "movement"
        else:
            raw = (
                data.get("movement")
                or data.get("movements")
                or data.get("Movement")
                or data.get("MovementList")
                or data.get("data")
                or data.get("items")
                or data.get("result")
                or data.get("response")
                or data.get("export")
                or data.get("list")
                or data.get("rows")
            )
            if raw is not None:
                source_hint = "known_key"

            def _take_raw_from_list(lst: Any) -> list | None:
                if not isinstance(lst, list) or not lst:
                    return None
                first = lst[0]
                if isinstance(first, dict) and is_movement_row_dict(first):
                    return lst
                if isinstance(first, list) and first and isinstance(first[0], dict):
                    return flatten_movement_list(lst)
                return None

            if raw is None:
                for v in data.values():
                    if isinstance(v, dict) and is_movement_row_dict(v):
                        raw = v
                        source_hint = "dict_value_movement"
                        break
                    candidate = _take_raw_from_list(v)
                    if candidate is not None:
                        raw = candidate
                        source_hint = "dict_value_list"
                        break
            if raw is None:
                for k, v in data.items():
                    candidate = _take_raw_from_list(v)
                    if candidate is not None:
                        raw = candidate
                        source_hint = f"key:{k}"
                        break
            if raw is None:
                for wrap in ("response", "data", "result", "export"):
                    inner = data.get(wrap)
                    if isinstance(inner, dict):
                        inner_list = inner.get("movement") or inner.get("movements") or inner.get("items")
                        candidate = _take_raw_from_list(inner_list) if isinstance(inner_list, list) else None
                        if candidate is not None:
                            raw = candidate
                            source_hint = f"{wrap}.movement"
                            break
            if raw is None and len(data) == 1:
                single_val = next(iter(data.values()), None)
                candidate = _take_raw_from_list(single_val) if single_val is not None else None
                if candidate is not None:
                    raw = candidate
                    source_hint = "single_key_list"
            if raw is not None:
                if isinstance(raw, list):
                    movements = raw
                elif isinstance(raw, dict):
                    if is_movement_row_dict(raw):
                        movements = [raw]
                    else:
                        inner = raw.get("movement") or raw.get("movements")
                        movements = inner if isinstance(inner, list) else [inner] if inner else []
                elif isinstance(raw, str):
                    try:
                        parsed = json.loads(raw)
                        movements = parsed if isinstance(parsed, list) else [parsed] if parsed else []
                        source_hint = (source_hint or "known_key") + "_json_str"
                    except (TypeError, ValueError, json.JSONDecodeError):
                        movements = []

    if not isinstance(movements, list):
        movements = [movements] if movements else []

    normalized: list = []
    for x in movements:
        if isinstance(x, dict):
            normalized.append(x)
        elif isinstance(x, list):
            normalized.extend(flatten_movement_list(x))
        elif isinstance(x, str):
            try:
                p = json.loads(x)
                if isinstance(p, list):
                    normalized.extend(p)
                elif isinstance(p, dict):
                    normalized.append(p)
            except (TypeError, ValueError, json.JSONDecodeError):
                pass
    movements = normalized

    expanded: list = []
    for x in movements:
        if isinstance(x, dict) and is_movement_row_dict(x):
            expanded.append(x)
        elif isinstance(x, dict):
            inner = x.get("movement") or x.get("movements") or x.get("Movement")
            if isinstance(inner, list):
                expanded.extend(inner)
            elif isinstance(inner, dict):
                expanded.append(inner)
            else:
                expanded.append(x)
        else:
            expanded.append(x)

    flattened: list = []
    for m in expanded:
        if not isinstance(m, dict):
            continue
        if is_movement_row_dict(m):
            flattened.append(m)
        else:
            inner = m.get("movement") or m.get("movements") or m.get("Movement")
            if isinstance(inner, list):
                flattened.extend(inner)
            elif isinstance(inner, dict):
                flattened.append(inner)

    rows = [m for m in flattened if isinstance(m, dict)]
    if rows and source_hint:
        logger.info("extract_movement_rows: %s ta qator (manba=%s)", len(rows), source_hint)
    return rows, source_hint
