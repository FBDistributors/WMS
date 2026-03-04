"""Tashkiliy harakatlar (cross-organizational movement) API — Smartup movement$export proxy."""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import require_permission
from app.integrations.smartup.mfm_movement import fetch_mfm_movements_raw

router = APIRouter()

# Qisqa cache: key = (begin, end, filial_id), value = (full_list, expiry_time). TTL 90 soniya.
_movements_cache: dict[tuple[date, date, str | None], tuple[list[Any], float]] = {}
_CACHE_TTL_SEC = 90


def _parse_date(value: str | None) -> date | None:
    """Parse YYYY-MM-DD or DD.MM.YYYY to date."""
    if not value or not str(value).strip():
        return None
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _get_cached_movements(begin: date, end: date, filial_id: str | None) -> list[Any]:
    """Cache or fetch full list; caller will slice."""
    now = time.monotonic()
    key = (begin, end, filial_id)
    if key in _movements_cache:
        full_list, expiry = _movements_cache[key]
        if now < expiry:
            return full_list
        del _movements_cache[key]
    raw = fetch_mfm_movements_raw(begin_date=begin, end_date=end, filial_id=filial_id)
    full_list = raw.get("movement") if isinstance(raw.get("movement"), list) else []
    _movements_cache[key] = (full_list, now + _CACHE_TTL_SEC)
    return full_list


@router.get("", summary="List movements from Smartup (movement$export)")
@router.get("/", summary="List movements from Smartup (movement$export)")
async def list_movements(
    begin_created_on: str | None = Query(None, description="Start date (YYYY-MM-DD or DD.MM.YYYY)"),
    end_created_on: str | None = Query(None, description="End date (YYYY-MM-DD or DD.MM.YYYY)"),
    filial_id: str | None = Query(None, description="Smartup filial_id (optional)"),
    limit: int = Query(50, ge=1, le=500, description="Max items per page"),
    offset: int = Query(0, ge=0, description="Skip N items"),
    _user=Depends(require_permission("orders:read")),
) -> dict[str, Any]:
    """
    Proxy to Smartup mfm movement$export. Returns "movement" (sliced) and "total".
    Default date range: last 30 days. Uses in-memory cache (90s TTL) for faster next pages.
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

    try:
        full_list = _get_cached_movements(begin, end, filial_id)
    except RuntimeError as exc:
        msg = str(exc)
        if "400" in msg or "не найдена" in msg or "organization" in msg.lower():
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=500, detail=msg) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Smartup movement export failed: {exc}") from exc

    total = len(full_list)
    chunk = full_list[offset : offset + limit]
    return {"movement": chunk, "total": total}
