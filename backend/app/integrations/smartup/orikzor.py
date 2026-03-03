"""O'rikzor harakatlari: Smartup movement$export orqali ichki harakatlarni yuklash."""

from __future__ import annotations

import base64
import json
import logging
import os
import urllib.error
import urllib.request
from collections import Counter
from datetime import date, datetime

from pydantic import ValidationError as PydanticValidationError

from app.integrations.smartup.schemas import SmartupOrder, SmartupOrderExportResponse


logger = logging.getLogger(__name__)


def _flatten_movement_list(lst: list) -> list:
    """Ro'yxat ichida ro'yxat bo'lsa (list of lists) bitta ro'yxatga yoyadi."""
    out: list = []
    for x in lst:
        if isinstance(x, list):
            out.extend(x)
        else:
            out.append(x)
    return out


def _structure_summary(obj, depth: int = 0, max_depth: int = 4):
    """JSON ob'ektining strukturasi (kalitlar, turi, ro'yxat uzunligi) — log uchun."""
    if depth >= max_depth:
        return "..."
    if isinstance(obj, dict):
        return {k: _structure_summary(v, depth + 1, max_depth) for k, v in obj.items()}
    if isinstance(obj, list):
        if not obj:
            return "[]"
        return [f"list[{len(obj)}]", _structure_summary(obj[0], depth + 1, max_depth)]
    return type(obj).__name__


# Smartup movement statuslari: barchasini import qilamiz. "N" = yangi, "C" = tasdiqlangan va h.k.
ALLOWED_MOVEMENT_STATUSES: set[str] = {"N", "C", "B#S", "D", "P"}  # N ni qo'shdik; kerak bo'lsa env orqali sozlash mumkin


def _parse_movement_date(value: str | None) -> datetime | None:
    """Smartup from_movement_date format: '31.01.2026 15:01:52' (DD.MM.YYYY HH:MM:SS). Fallback: %d.%m.%Y."""
    if not value or not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%d.%m.%Y %H:%M:%S")
    except (ValueError, TypeError):
        try:
            return datetime.strptime(raw, "%d.%m.%Y")
        except (ValueError, TypeError):
            return None


def _parse_movement_response(
    body: str,
    begin_date: date | None = None,
    end_date: date | None = None,
) -> SmartupOrderExportResponse:
    """movement$export javobini parse qiladi; bitta joyda movement/movements/list va movement_items/itens."""
    raw_count = len(body)
    data = json.loads(body)
    movements: list = []

    if isinstance(data, list):
        movements = data
    elif isinstance(data, dict):
        if data.get("movement_id") is not None or data.get("movement_number") is not None:
            movements = [data]
        elif isinstance(data.get("movement"), list):
            movements = _flatten_movement_list(data["movement"])
            logger.info("Smartup movement$export: data['movement'] dan %s ta olindi", len(movements))
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
            def _is_movement_dict(d):
                return isinstance(d, dict) and (
                    d.get("movement_id") is not None or d.get("movement_number") is not None
                )

            def _take_raw_from_list(lst):
                if not isinstance(lst, list) or not lst:
                    return None
                first = lst[0]
                if isinstance(first, dict) and _is_movement_dict(first):
                    return lst
                if isinstance(first, list) and first and isinstance(first[0], dict):
                    return _flatten_movement_list(lst)
                return None

            if raw is None and isinstance(data, dict):
                for v in data.values():
                    if isinstance(v, dict) and _is_movement_dict(v):
                        raw = v
                        break
                    candidate = _take_raw_from_list(v)
                    if candidate is not None:
                        raw = candidate
                        break
            if raw is None and isinstance(data, dict):
                for k, v in data.items():
                    candidate = _take_raw_from_list(v)
                    if candidate is not None:
                        raw = candidate
                        logger.info("Smartup movement$export: ro'yxat '%s' kalitida topildi (len=%s)", k, len(raw))
                        break
            if raw is None and isinstance(data, dict):
                for wrap in ("response", "data", "result", "export"):
                    inner = data.get(wrap)
                    if isinstance(inner, dict):
                        inner_list = inner.get("movement") or inner.get("movements") or inner.get("items")
                        candidate = _take_raw_from_list(inner_list) if isinstance(inner_list, list) else None
                        if candidate is not None:
                            raw = candidate
                            logger.info("Smartup movement$export: ro'yxat '%s.%s' ichida topildi (len=%s)", wrap, "movement|movements|items", len(raw))
                            break
                    if raw is not None:
                        break
            if raw is None and isinstance(data, dict) and len(data) == 1:
                single_val = next(iter(data.values()), None)
                candidate = _take_raw_from_list(single_val) if single_val is not None else None
                if candidate is not None:
                    raw = candidate
                    logger.info("Smartup movement$export: bitta kalit ostidagi ro'yxat ishlatildi (len=%s)", len(raw))
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
        elif isinstance(x, list):
            normalized.extend(_flatten_movement_list(x))
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
            inner = x.get("movement") or x.get("movements") or x.get("Movement")
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
            inner = m.get("movement") or m.get("movements") or m.get("Movement")
            if isinstance(inner, list):
                flattened.extend(inner)
            elif isinstance(inner, dict):
                flattened.append(inner)
    movements = [m for m in flattened if isinstance(m, dict)]
    # Hech qanday limit/pagination yo'q — barcha movementlar ishlatiladi
    pre_filter_count = len(movements)
    raw_count = pre_filter_count  # invariant: raw_count = len(movements)

    logger.info(
        "O'rikzor parse: Smartup from_movement_date format DD.MM.YYYY HH:MM:SS (fallback DD.MM.YYYY). "
        "UI date DD/MM/YYYY yoki MM/DD/YYYY. raw_count=%s",
        raw_count,
    )

    skipped_by_reason: dict[str, int] = {
        "missing_id": 0,
        "status_not_allowed": 0,
        "product_not_found": 0,
        "warehouse_null_or_not_found": 0,
        "date_parse_error": 0,
        "out_of_range": 0,
        "db_error": 0,
        "validation_error": 0,
        "exception": 0,
    }

    # Sana bo'yicha filtrlash (begin_date, end_date berilgan bo'lsa)
    start_dt = datetime.combine(begin_date, datetime.min.time()) if begin_date else None
    end_dt = datetime.combine(end_date, datetime.max.time()) if end_date else None
    movements_in_range: list = []
    out_of_range_samples: list = []  # 3 ta sample debug uchun

    if begin_date is not None and end_date is not None:
        for m in movements:
            from_raw = m.get("from_movement_date")
            from_str = str(from_raw).strip() if from_raw is not None else ""
            parsed_from_dt = _parse_movement_date(from_raw) if from_raw else None
            if parsed_from_dt is None:
                # Sana parse bo'lmasa — oralikda deb hisoblaymiz (o'tkazamiz)
                movements_in_range.append(m)
                continue
            mov_date = parsed_from_dt.date()
            if mov_date < begin_date or mov_date > end_date:
                skipped_by_reason["out_of_range"] += 1
                reason = (
                    f"mov_date={mov_date!s} < start={begin_date!s}" if mov_date < begin_date
                    else f"mov_date={mov_date!s} > end={end_date!s}"
                )
                if len(out_of_range_samples) < 3:
                    out_of_range_samples.append({
                        "movement_id": m.get("movement_id") or m.get("movement_number"),
                        "status": m.get("status"),
                        "from_movement_date": from_str or None,
                        "parsed_from_dt": parsed_from_dt.isoformat() if parsed_from_dt else None,
                        "start_dt": begin_date.isoformat(),
                        "end_dt": end_date.isoformat(),
                        "out_of_range_reason": reason,
                    })
                continue
            movements_in_range.append(m)
    else:
        movements_in_range = list(movements)

    after_date_filter_count = len(movements_in_range)
    dict_count = raw_count  # parse invariant: raw_count = len(movements) (date filter oldin)

    # Status histogram: Smartup dan qaysi statuslar kelgani (case-sensitive va bo'sh)
    status_histogram = Counter(
        (m.get("status") or "").strip() or "(empty)" for m in movements_in_range
    )
    logger.info(
        "O'rikzor status_histogram (candidate movements): raw_count=%s after_date_filter=%s histogram=%s",
        raw_count,
        after_date_filter_count,
        dict(status_histogram),
    )

    for i, sample in enumerate(out_of_range_samples[:3]):
        logger.info(
            "O'rikzor out_of_range sample [%s]: movement_id=%s status=%s from_movement_date=%s parsed_from_dt=%s start_dt=%s end_dt=%s reason=%s",
            i + 1,
            sample.get("movement_id"),
            sample.get("status"),
            sample.get("from_movement_date"),
            sample.get("parsed_from_dt"),
            sample.get("start_dt"),
            sample.get("end_dt"),
            sample.get("out_of_range_reason"),
        )

    status_filter_off = os.getenv("SMARTUP_ORIKZOR_STATUS_FILTER_OFF", "").strip().lower() in ("1", "true", "yes")

    orders: list[SmartupOrder] = []
    first_validation_error: str | None = None
    loop_count = 0
    skipped_out_of_range = skipped_by_reason.get("out_of_range", 0)
    for m in movements_in_range:
        loop_count += 1
        raw_id = m.get("movement_id")
        raw_num = m.get("movement_number")
        movement_id = (str(raw_id) if raw_id is not None else "").strip() or (str(raw_num) if raw_num is not None else "").strip()
        movement_number = (str(raw_num) if raw_num is not None else str(raw_id) if raw_id is not None else "").strip()
        if not movement_id and not movement_number:
            skipped_by_reason["missing_id"] += 1
            continue
        movement_id = movement_id or movement_number
        raw_status = (m.get("status") or "").strip()
        # Normalize to uppercase: Smartup "c"/"n" qaytarsa ham "C"/"N" sifatida qabul qilamiz
        normalized_status = raw_status.upper() if raw_status else ""
        if not status_filter_off and ALLOWED_MOVEMENT_STATUSES and normalized_status and normalized_status not in ALLOWED_MOVEMENT_STATUSES:
            skipped_by_reason["status_not_allowed"] += 1
            if raw_status != normalized_status:
                logger.debug(
                    "O'rikzor: status skipped (raw=%r normalized=%r allowed=%s)",
                    raw_status,
                    normalized_status,
                    sorted(ALLOWED_MOVEMENT_STATUSES),
                )
            continue

        # from/to_warehouse_code null bo'lsa skip qilmaymiz — default warehouse (filial) ishlatamiz
        default_warehouse_code = (os.getenv("DEFAULT_WAREHOUSE_CODE") or os.getenv("SMARTUP_DEFAULT_FILIAL") or "MAIN").strip()
        filial = (
            m.get("filial_code") or m.get("from_warehouse_code") or m.get("to_warehouse_code") or default_warehouse_code
        )
        if not (filial or "").strip():
            skipped_by_reason["warehouse_null_or_not_found"] += 1
            continue

        from_movement_date_raw = m.get("from_movement_date")
        if from_movement_date_raw is not None and str(from_movement_date_raw).strip():
            if _parse_movement_date(str(from_movement_date_raw)) is None:
                skipped_by_reason["date_parse_error"] += 1
                continue

        items = (
            m.get("movement_items")
            or m.get("movement_itens")
            or m.get("movementItems")
            or []
        )
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
                qty = float(it.get("quantity") or it.get("qty") or 0)
            except (TypeError, ValueError):
                qty = 0
            lines.append({
                "product_code": it.get("product_code") or it.get("productCode"),
                "sku": it.get("product_code") or it.get("productCode"),
                "quantity": qty,
                "name": it.get("product_article_code") or it.get("productArticleCode") or it.get("product_code") or it.get("productCode") or "",
            })

        external_key = (m.get("external_id") or "").strip() or f"movement:{movement_id}"
        order_dict = {
            "external_id": external_key,
            "deal_id": movement_id,
            "order_no": movement_number,
            "status": "B#S",
            "filial_id": filial,
            "filial_code": filial,
            "lines": lines,
        }
        try:
            validate = getattr(SmartupOrder, "model_validate", getattr(SmartupOrder, "parse_obj", None))
            if validate:
                orders.append(validate(order_dict))
            else:
                skipped_by_reason["validation_error"] += 1
                if first_validation_error is None:
                    first_validation_error = f"movement_id={movement_id!r} SmartupOrder.model_validate yo'q"
        except PydanticValidationError as exc:
            skipped_by_reason["validation_error"] += 1
            if first_validation_error is None:
                first_validation_error = f"movement_id={movement_id!r} {type(exc).__name__}: {exc}"
            logger.warning(
                "O'rikzor movement to order skip movement_id=%s reason=%s",
                movement_id,
                exc,
                exc_info=False,
            )
        except Exception as exc:  # noqa: BLE001
            skipped_by_reason["exception"] += 1
            if first_validation_error is None:
                first_validation_error = f"movement_id={movement_id!r} {type(exc).__name__}: {exc}"
            logger.exception(
                "O'rikzor movement import failed: movement_id=%s %s",
                movement_id,
                exc,
            )

    filtered_count = len(orders)

    def _first_item_preview(m: dict) -> dict:
        items = m.get("movement_items") or m.get("movement_itens") or m.get("movementItems") or []
        first = items[0] if isinstance(items, list) and items and isinstance(items[0], dict) else {}
        return {
            "product_code": first.get("product_code") or first.get("productCode"),
            "product_article_code": first.get("product_article_code") or first.get("productArticleCode"),
            "quantity": first.get("quantity") or first.get("qty"),
        }

    previews = []
    for m in movements[:2]:
        previews.append({
            "movement_id": (m.get("movement_id") or m.get("movement_number") or ""),
            "movement_number": m.get("movement_number"),
            "status": m.get("status"),
            "external_id": m.get("external_id"),
            "from_warehouse_code": m.get("from_warehouse_code"),
            "to_warehouse_code": m.get("to_warehouse_code"),
            "from_movement_date": m.get("from_movement_date"),
            "first_item": _first_item_preview(m),
        })

    parse_skipped_total = sum(skipped_by_reason.values())
    parse_processed = filtered_count + parse_skipped_total
    discrepancy: bool | None = None
    if raw_count != parse_processed:
        discrepancy = True
        logger.error(
            "DISCREPANCY raw_count=%s processed=%s filtered=%s skipped_total=%s reasons=%s",
            raw_count,
            parse_processed,
            filtered_count,
            parse_skipped_total,
            skipped_by_reason,
        )
    logger.info(
        "O'rikzor parse debug: raw_count=%s after_date_filter_count=%s loop_count=%s filtered_count=%s skipped_total=%s skipped_out_of_range=%s reasons=%s",
        raw_count,
        after_date_filter_count,
        loop_count,
        filtered_count,
        parse_skipped_total,
        skipped_out_of_range,
        skipped_by_reason,
    )

    if movements and not orders and first_validation_error:
        logger.info(
            "O'rikzor parse: %s ta movementdan 0 ta order — birinchi xato: %s",
            len(movements),
            first_validation_error,
        )

    parse_warning: str | None = None
    if movements and not orders and first_validation_error:
        parse_warning = f"{len(movements)} ta movementdan 0 ta order. Birinchi xato: {first_validation_error}"

    return SmartupOrderExportResponse(
        items=orders,
        parse_warning=parse_warning,
        debug_raw_count=raw_count,
        debug_dict_count=dict_count,
        debug_skipped_by_reason=skipped_by_reason,
        debug_preview=previews,
        debug_discrepancy=discrepancy,
        debug_pre_filter_count=pre_filter_count,
        debug_after_date_filter_count=after_date_filter_count,
        debug_loop_count=loop_count,
        debug_skipped_out_of_range=skipped_out_of_range,
        debug_status_histogram=dict(status_histogram),
    )


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
        "Smartup movement$export: url=%s sana=%s..%s body=%s",
        url.split("?")[0],
        begin_str,
        end_str,
        json.dumps(payload),
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

    parsed = _parse_movement_response(body, begin_date=begin_date, end_date=end_date)
    if parsed.items:
        logger.info("Smartup movement$export: %s ta movement", len(parsed.items))
    else:
        try:
            raw = json.loads(body)
            keys = list(raw.keys()) if isinstance(raw, dict) else []
            structure = _structure_summary(raw)
            logger.warning(
                "Smartup movement$export: 0 ta order (body_len=%s). Kalitlar=%s struktura=%s",
                len(body),
                keys,
                structure,
            )
            logger.warning(
                "Smartup movement$export: body preview (birinchi 2000 belgi): %s",
                (body[:2000] + "...") if len(body) > 2000 else body,
            )
        except Exception:  # noqa: S110
            logger.warning(
                "Smartup movement$export: API dan 0 ta movement qaytdi (body_len=%s).",
                len(body),
            )
    return parsed
