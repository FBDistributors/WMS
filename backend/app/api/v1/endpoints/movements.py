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
from app.models.order import Order as OrderModel
from app.models.order import OrderWmsState as OrderWmsStateModel

router = APIRouter()

# Cache: key includes smartup_status_key; value = (full_list, expiry). TTL 15 min.
_movements_cache: dict[tuple, tuple[list[Any], float]] = {}
_CACHE_TTL_SEC = 900
_SMARTUP_STATUS_PARAM_MAX = 200
_SMARTUP_STATUS_TOKEN_RE = re.compile(r"^[A-Z0-9#]{1,32}$")
_WMS_STATUS_MAP: dict[str, frozenset[str] | None] = {
    # SmartUp: yangi harakatlar odatda W; WMS da hali yig'ishga ketmaganlar ro'yxatda qoladi
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


def _movement_external_id(movement_id: str) -> str:
    """Order.source_external_id bilan bir xil (max 128)."""
    return f"movement:{movement_id.strip()}"[:128]


def _enrich_movements_chunk_with_wms(db: Session, chunk: list[Any]) -> list[Any]:
    """
    Har qator nusxasi: wms_order_status (Order.wms_state.status yoki None).
    Keshdagi dict larni mutatsiya qilmaydi.
    """
    if not chunk:
        return []
    ext_ids: set[str] = set()
    for m in chunk:
        if isinstance(m, dict):
            mid = str(m.get("movement_id") or "").strip()
            if mid:
                ext_ids.add(_movement_external_id(mid))
    status_by_ext: dict[str, str] = {}
    if ext_ids:
        rows = (
            db.query(OrderModel.source_external_id, OrderWmsStateModel.status)
            .join(OrderWmsStateModel, OrderWmsStateModel.order_id == OrderModel.id)
            .filter(OrderModel.source == "diller", OrderModel.source_external_id.in_(ext_ids))
            .all()
        )
        status_by_ext = {str(r[0]): str(r[1]) for r in rows if r[0] is not None}
    out: list[Any] = []
    for m in chunk:
        if not isinstance(m, dict):
            out.append(m)
            continue
        mid = str(m.get("movement_id") or "").strip()
        ext = _movement_external_id(mid) if mid else ""
        wms = status_by_ext.get(ext) if ext else None
        out.append({**m, "wms_order_status": wms})
    return out


def _movement_is_wms_new(wms_order_status: Any) -> bool:
    """Yig'ishga yuborilmagan: WMS yozuvi yo'q yoki imported / B#W."""
    if wms_order_status is None:
        return True
    s = str(wms_order_status).strip()
    if not s:
        return True
    low = s.lower()
    return low in ("imported", "b#w")


def _filter_movements_wms_new(enriched: list[Any]) -> list[Any]:
    """wms_status=new: SmartUp W dan keyin faqat WMS jihatdan 'yangi' qatorlar."""
    return [
        m
        for m in enriched
        if isinstance(m, dict) and _movement_is_wms_new(m.get("wms_order_status"))
    ]


def _slice_movements_response(
    db: Session,
    full_list: list[Any],
    wms_status_key: str | None,
    offset: int,
    limit: int,
) -> dict[str, Any]:
    """Paginatsiya; wms:new uchun avval WMS boyitish + filtr."""
    if wms_status_key == "new":
        enriched = _enrich_movements_chunk_with_wms(db, full_list)
        filtered = _filter_movements_wms_new(enriched)
        total = len(filtered)
        chunk = filtered[offset : offset + limit]
        return {"movement": chunk, "total": total}
    total = len(full_list)
    chunk = full_list[offset : offset + limit]
    return {"movement": _enrich_movements_chunk_with_wms(db, chunk), "total": total}


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
        description="WMS status filter: new (SmartUp W + WMS imported/B#W/yozuvsiz), picking, ...",
    ),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:read")),
) -> dict[str, Any]:
    """
    Proxy to Smartup mfm movement$export. Returns "movement" (sliced) and "total".
    begin_modified_on/end_modified_on berilsa faqat o'zgarishlar yuklanadi (delta sync).
    wms_status=new: SmartUp dan W, keyin WMS boyicha yig'ishga ketganlar chiqariladi.
    Boshqa wms_status: SmartUp status xaritasi; wms yo'q bo'lsa smartup_status.
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
            return _slice_movements_response(db, full_list, wms_status_key, offset, limit)
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

    return _slice_movements_response(db, full_list, wms_status_key, offset, limit)
