"""Tashkiliy harakatlar (cross-organizational movement) API — Smartup movement$export proxy."""

from __future__ import annotations

import asyncio
import re
import time
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.integrations.smartup.mfm_movement import fetch_mfm_movements_raw

router = APIRouter()

# Cache: key includes smartup_status_key; value = (full_list, expiry). TTL 15 min.
_movements_cache: dict[tuple, tuple[list[Any], float]] = {}
_CACHE_TTL_SEC = 900
_SMARTUP_STATUS_PARAM_MAX = 200
_SMARTUP_STATUS_TOKEN_RE = re.compile(r"^[A-Z0-9#]{1,32}$")
_WMS_STATUS_MAP: dict[str, frozenset[str] | None] = {
    # "Yangi" faqat Smartup W statusiga teng
    "new": frozenset({"W"}),
    "picking": frozenset({"C"}),
    "review": frozenset({"L", "P", "PICKED", "REVIEW", "CHECK"}),
    "completed": frozenset({"S", "B#S", "B#V", "SHIPPED", "DELIVERED"}),
    "cancelled": frozenset({"A", "CANCELLED"}),
    "all": None,
}


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


def _parse_smartup_status_param(value: str) -> tuple[str, frozenset[str] | None]:
    """
    Qaytaradi: (cache_key, allowed_statuses yoki None = filtrsiz).
    all/* — barcha statuslar; W — default; N,W,B#W — vergul bilan ro'yxat.
    """
    s = (value or "W").strip()
    if not s:
        return ("W", frozenset({"W"}))
    if len(s) > _SMARTUP_STATUS_PARAM_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"smartup_status juda uzun (max {_SMARTUP_STATUS_PARAM_MAX})",
        )
    low = s.lower()
    if low in ("all", "*"):
        return ("all", None)
    parts = [p.strip().upper() for p in s.split(",") if p.strip()]
    if not parts:
        raise HTTPException(
            status_code=400,
            detail="smartup_status: bo'sh yoki noto'g'ri format",
        )
    for p in parts:
        if not _SMARTUP_STATUS_TOKEN_RE.match(p):
            raise HTTPException(
                status_code=400,
                detail=f"smartup_status: ruxsat etilmagan token (A-Z, 0-9, #, max 32): {p}",
            )
    if len(parts) == 1:
        return (parts[0], frozenset(parts))
    cache_key = ",".join(sorted(parts))
    return (cache_key, frozenset(parts))


def _parse_wms_status_param(value: str | None) -> tuple[str | None, frozenset[str] | None]:
    """
    Qaytaradi: (wms_status_key yoki None, allowed_statuses yoki None).
    None/bo'sh bo'lsa smartup_status fallback ishlatiladi.
    """
    if value is None:
        return (None, None)
    s = value.strip().lower()
    if not s:
        return (None, None)
    if s not in _WMS_STATUS_MAP:
        allowed = ", ".join(sorted(_WMS_STATUS_MAP.keys()))
        raise HTTPException(status_code=400, detail=f"wms_status noto'g'ri. Ruxsat etilgan: {allowed}")
    return (s, _WMS_STATUS_MAP[s])


def _fetch_movements_sync(
    begin: date,
    end: date,
    filial_id: str | None,
    begin_modified_on: date | None = None,
    end_modified_on: date | None = None,
    status_allowed: frozenset[str] | None = None,
) -> list[Any]:
    """Smartup dan to'liq ro'yxat. status_allowed None bo'lsa status bo'yicha filtr yo'q; aks holda IN jadvali."""
    raw = fetch_mfm_movements_raw(
        begin_date=begin,
        end_date=end,
        filial_id=filial_id,
        begin_modified_on=begin_modified_on,
        end_modified_on=end_modified_on,
    )
    movement_list = raw.get("movement") if isinstance(raw.get("movement"), list) else []
    if status_allowed is None:
        return [m for m in movement_list if isinstance(m, dict)]
    return [
        m
        for m in movement_list
        if isinstance(m, dict)
        and (str(m.get("status") or "").strip().upper() in status_allowed)
    ]


@router.get("", summary="List movements from Smartup (movement$export)")
@router.get("/", summary="List movements from Smartup (movement$export)")
async def list_movements(
    begin_created_on: str | None = Query(None, description="Start date (YYYY-MM-DD or DD.MM.YYYY)"),
    end_created_on: str | None = Query(None, description="End date (YYYY-MM-DD or DD.MM.YYYY)"),
    begin_modified_on: str | None = Query(None, description="Delta: faqat shu sanadan o'zgartirilganlar"),
    end_modified_on: str | None = Query(None, description="Delta: faqat shu sanagacha o'zgartirilganlar"),
    filial_id: str | None = Query(None, description="Smartup filial_id (optional)"),
    limit: int = Query(50, ge=1, le=500, description="Max items per page"),
    offset: int = Query(0, ge=0, description="Skip N items"),
    refresh: bool = Query(False, description="Cache ni bypass qilish, SmartUP dan qayta yuklash"),
    smartup_status: str = Query(
        "W",
        description="Smartup harakat statusi: W (default), all yoki * (hammasi), yoki vergul bilan: N,W,B#W",
    ),
    wms_status: str | None = Query(
        None,
        description="WMS status filter: new, picking, review, completed, cancelled, all",
    ),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:read")),
) -> dict[str, Any]:
    """
    Proxy to Smartup mfm movement$export. Returns "movement" (sliced) and "total".
    begin_modified_on/end_modified_on berilsa faqat o'zgarishlar yuklanadi (delta sync).
    wms_status berilsa mapped filter ishlaydi (new faqat W), aks holda smartup_status ishlaydi.
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
        # Default: oxirgi 1 oy o'zgarishlar (delta — tezroq)
        end_mod = end_mod or today
        begin_mod = begin_mod or (today - timedelta(days=30))
    if begin_mod > end_mod:
        begin_mod, end_mod = end_mod, begin_mod

    wms_status_key, wms_status_allowed = _parse_wms_status_param(wms_status)
    if wms_status_key is not None:
        status_cache_key = f"wms:{wms_status_key}"
        status_allowed = wms_status_allowed
    else:
        status_cache_key, status_allowed = _parse_smartup_status_param(smartup_status)

    now = time.monotonic()
    key = (begin, end, filial_id, begin_mod, end_mod, status_cache_key)
    if not refresh and key in _movements_cache:
        full_list, expiry = _movements_cache[key]
        if now < expiry:
            total = len(full_list)
            chunk = full_list[offset : offset + limit]
            return {"movement": chunk, "total": total}
        del _movements_cache[key]

    try:
        full_list = await asyncio.to_thread(
            _fetch_movements_sync,
            begin,
            end,
            filial_id,
            begin_mod,
            end_mod,
            status_allowed,
        )
        _movements_cache[key] = (full_list, now + _CACHE_TTL_SEC)
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
