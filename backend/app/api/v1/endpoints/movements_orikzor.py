"""O'rikzor harakatlari API — Smartup movement$export proxy (Tashkiliy harakat kabi, Order bilan aloqasi yo'q)."""

from __future__ import annotations

import asyncio
import time
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import require_permission
from app.integrations.smartup.orikzor import fetch_orikzor_movements_raw

router = APIRouter()

_CACHE: dict[tuple, tuple[list[Any], float]] = {}
_CACHE_TTL_SEC = 900


def _parse_date(value: str | None) -> date | None:
    if not value or not str(value).strip():
        return None
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _raw_to_display(m: dict[str, Any]) -> dict[str, Any]:
    """Smartup raw movement ni frontend kutilgan formatga aylantiradi."""
    mid = m.get("movement_id") or m.get("movement_number") or ""
    barcode = (m.get("external_id") or "").strip() or (f"movement:{mid}" if mid else "")
    items = m.get("movement_items") or m.get("movement_itens") or m.get("movementItems") or []
    if not isinstance(items, list):
        items = [items] if items else []
    movement_items = [
        {
            "product_code": it.get("product_code") or it.get("productCode"),
            "quantity": it.get("quantity") or it.get("qty") or 0,
            "name": it.get("name") or it.get("product_code") or it.get("productCode") or "",
        }
        for it in items
        if isinstance(it, dict)
    ]
    from_date = m.get("from_movement_date") or m.get("fromMovementDate") or ""
    return {
        "movement_id": mid,
        "barcode": barcode,
        "from_warehouse_code": m.get("from_warehouse_code"),
        "to_warehouse_code": m.get("to_warehouse_code"),
        "note": m.get("note"),
        "amount": m.get("amount"),
        "status": m.get("status"),
        "from_time": from_date,
        "from_movement_date": from_date,
        "movement_items": movement_items,
    }


def _fetch_orikzor_sync(
    begin: date,
    end: date,
    filial_id: str | None,
    begin_modified_on: date | None = None,
    end_modified_on: date | None = None,
) -> list[dict[str, Any]]:
    """Smartup dan O'rikzor harakatlari ro'yxatini oladi (bloklovchi — thread da chaqiriladi). modified_on orqali delta."""
    raw_list = fetch_orikzor_movements_raw(
        begin_date=begin,
        end_date=end,
        filial_id=filial_id,
        begin_modified_on=begin_modified_on,
        end_modified_on=end_modified_on,
    )
    return [_raw_to_display(m) for m in raw_list if isinstance(m, dict)]


@router.get("", summary="List O'rikzor movements from Smartup (movement$export proxy)")
@router.get("/", summary="List O'rikzor movements from Smartup (movement$export proxy)")
async def list_movements_orikzor(
    begin_created_on: str | None = Query(None, description="Start date (YYYY-MM-DD or DD.MM.YYYY)"),
    end_created_on: str | None = Query(None, description="End date (YYYY-MM-DD or DD.MM.YYYY)"),
    begin_modified_on: str | None = Query(None, description="Delta: faqat shu sanadan o'zgartirilganlar"),
    end_modified_on: str | None = Query(None, description="Delta: faqat shu sanagacha o'zgartirilganlar"),
    filial_id: str | None = Query(None, description="Smartup filial_id (optional)"),
    limit: int = Query(50, ge=1, le=500, description="Max items per page"),
    offset: int = Query(0, ge=0, description="Skip N items"),
    refresh: bool = Query(False, description="Cache ni bypass qilish"),
    _user=Depends(require_permission("orders:read")),
) -> dict[str, Any]:
    """
    O'rikzor harakatlari — Smartup movement$export orqali (Tashkiliy harakat kabi alohida API).
    begin_modified_on/end_modified_on berilsa faqat o'zgarishlar yuklanadi (delta sync).
    Order jadvaliga yozilmaydi, faqat Smartup dan proxy + cache.
    """
    today = date.today()
    begin = _parse_date(begin_created_on)
    end = _parse_date(end_created_on)
    if begin is None and end is None:
        end = today
        begin = today - timedelta(days=30)
    elif begin is None:
        begin = end - timedelta(days=30) if end else today - timedelta(days=30)
    elif end is None:
        end = begin + timedelta(days=30) if begin else today
    if begin > end:
        raise HTTPException(status_code=400, detail="begin_created_on must be <= end_created_on")

    begin_mod = _parse_date(begin_modified_on)
    end_mod = _parse_date(end_modified_on)
    if begin_mod is None or end_mod is None:
        # Default: oxirgi 1 oy o'zgarishlar (delta — tezroq, Tashkiliy harakat kabi)
        end_mod = end_mod or today
        begin_mod = begin_mod or (today - timedelta(days=30))
    if begin_mod > end_mod:
        begin_mod, end_mod = end_mod, begin_mod

    key = (begin, end, filial_id, begin_mod, end_mod)
    now = time.monotonic()
    if not refresh and key in _CACHE:
        full_list, expiry = _CACHE[key]
        if now < expiry:
            total = len(full_list)
            chunk = full_list[offset : offset + limit]
            return {"movement": chunk, "total": total}
        del _CACHE[key]

    try:
        full_list = await asyncio.to_thread(
            _fetch_orikzor_sync, begin, end, filial_id, begin_mod, end_mod
        )
        _CACHE[key] = (full_list, now + _CACHE_TTL_SEC)
    except RuntimeError as exc:
        msg = str(exc)
        if "400" in msg or "не найдена" in msg.lower():
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=500, detail=msg) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"O'rikzor export failed: {exc}") from exc

    total = len(full_list)
    chunk = full_list[offset : offset + limit]
    return {"movement": chunk, "total": total}
