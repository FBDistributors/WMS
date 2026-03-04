"""O'rikzor harakatlari API — Smartup mkw/movement$export proxy (alohida URL)."""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import require_permission
from app.integrations.smartup.orikzor import fetch_orikzor_movements_raw

router = APIRouter()

_orikzor_cache: dict[tuple[date, date, str | None], tuple[list[Any], float]] = {}
_CACHE_TTL_SEC = 90


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


def _get_cached_orikzor_movements(begin: date, end: date, filial_id: str | None) -> list[Any]:
    now = time.monotonic()
    key = (begin, end, filial_id)
    if key in _orikzor_cache:
        full_list, expiry = _orikzor_cache[key]
        if now < expiry:
            return full_list
        del _orikzor_cache[key]
    full_list = fetch_orikzor_movements_raw(
        begin_date=begin, end_date=end, filial_id=filial_id
    )
    _orikzor_cache[key] = (full_list, now + _CACHE_TTL_SEC)
    return full_list


@router.get("", summary="List O'rikzor movements from Smartup (mkw/movement$export)")
@router.get("/", summary="List O'rikzor movements from Smartup (mkw/movement$export)")
async def list_movements_orikzor(
    begin_created_on: str | None = Query(None, description="Start date (YYYY-MM-DD or DD.MM.YYYY)"),
    end_created_on: str | None = Query(None, description="End date (YYYY-MM-DD or DD.MM.YYYY)"),
    filial_id: str | None = Query(None, description="Smartup filial_id (optional)"),
    limit: int = Query(50, ge=1, le=500, description="Max items per page"),
    offset: int = Query(0, ge=0, description="Skip N items"),
    _user=Depends(require_permission("orders:read")),
) -> dict[str, Any]:
    """
    Proxy to O'rikzor Smartup movement$export (alohida API URL).
    Returns "movement" (sliced) and "total". Default date range: last 30 days.
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
        full_list = _get_cached_orikzor_movements(begin, end, filial_id)
    except RuntimeError as exc:
        msg = str(exc)
        if "400" in msg or "не найдена" in msg:
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=500, detail=msg) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"O'rikzor movement export failed: {exc}"
        ) from exc

    total = len(full_list)
    chunk = full_list[offset : offset + limit]
    return {"movement": chunk, "total": total}
