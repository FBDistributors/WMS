"""Tashkiliy harakatlar (cross-organizational movement) API — Smartup movement$export proxy."""

from __future__ import annotations

import asyncio
import re
import time
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.integrations.smartup.mfm_movement import fetch_mfm_movements_raw, resolve_movement_export_date_range
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
    filial_id: str | None,
    status_allowed: frozenset[str] | None = None,
) -> list[Any]:
    """Smartup dan to'liq ro'yxat. status_allowed None bo'lsa status bo'yicha filtr yo'q; aks holda IN jadvali."""
    begin, end = resolve_movement_export_date_range(None, None)
    raw = fetch_mfm_movements_raw(begin, end, filial_id=filial_id)
    movement_list = raw.get("movement") if isinstance(raw.get("movement"), list) else []
    if status_allowed is None:
        return [m for m in movement_list if isinstance(m, dict)]
    return [
        m
        for m in movement_list
        if isinstance(m, dict)
        and (str(m.get("status") or "").strip().upper() in status_allowed)
    ]


def _diller_source_external_id_candidates(m: dict) -> list[str]:
    """
    Import (mfm) bilan bir xil kalitlar: SmartUp external_id, yoki mfm:{movement_id}, yoki movement:{id} (legacy).
    """
    mid = str(m.get("movement_id") or m.get("movement_number") or "").strip()
    ext = str(m.get("external_id") or "").strip()
    out: list[str] = []
    if ext:
        out.append(ext)
    if mid:
        out.append(f"mfm:{mid}")
        out.append(f"movement:{mid}")
    seen: set[str] = set()
    dedup: list[str] = []
    for x in out:
        if x and x not in seen:
            seen.add(x)
            dedup.append(x)
    return dedup


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
            for c in _diller_source_external_id_candidates(m):
                ext_ids.add(c)
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
        wms = None
        if isinstance(m, dict):
            for c in _diller_source_external_id_candidates(m):
                if c in status_by_ext:
                    wms = status_by_ext[c]
                    break
        out.append({**m, "wms_order_status": wms})
    return out


def _movement_is_wms_new(wms_order_status: Any) -> bool:
    """Yig'ishga yuborilmagan: WMS yozuvi yo'q yoki imported (legacy B#W migratsiyadan keyin ham imported)."""
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
    begin_created_on: str | None = Query(
        None,
        description="Eski API: endi SmartUp mfm so'rovida ishlatilmaydi (sana filtri yo'q).",
    ),
    end_created_on: str | None = Query(
        None,
        description="Eski API: endi SmartUp mfm so'rovida ishlatilmaydi.",
    ),
    begin_modified_on: str | None = Query(
        None,
        description="Eski API: endi SmartUp mfm so'rovida ishlatilmaydi.",
    ),
    end_modified_on: str | None = Query(
        None,
        description="Eski API: endi SmartUp mfm so'rovida ishlatilmaydi.",
    ),
    filial_id: str | None = Query(None, description="Smartup filial_id (optional)"),
    limit: int = Query(50, ge=1, le=500, description="Max items per page"),
    offset: int = Query(0, ge=0, description="Skip N items"),
    refresh: bool = Query(False, description="Cache ni bypass qilish, SmartUP dan qayta yuklash"),
    smartup_status: str = Query(
        "W",
        description="Smartup harakat statusi: W (default), all yoki * (hammasi), yoki vergul bilan: N,W",
    ),
    wms_status: str | None = Query(
        None,
        description="WMS status filter: new (SmartUp W + WMS imported/yozuvsiz), picking, ...",
    ),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:read")),
) -> dict[str, Any]:
    """
    Proxy to Smartup mfm movement$export. Returns "movement" (sliced) and "total".
    SmartUp ga sana oralig'i yuborilmaydi (barcha begin_* / end_* query parametrlari endi faqat moslik uchun).
    wms_status=new: SmartUp dan W, keyin WMS boyicha yig'ishga ketganlar chiqariladi.
    Boshqa wms_status: SmartUp status xaritasi; wms yo'q bo'lsa smartup_status.
    """
    _ = (begin_created_on, end_created_on, begin_modified_on, end_modified_on)

    wms_status_key, wms_status_allowed = _parse_wms_status_param(wms_status)
    if wms_status_key is not None:
        status_cache_key = f"wms:{wms_status_key}"
        status_allowed = wms_status_allowed
    else:
        status_cache_key, status_allowed = _parse_smartup_status_param(smartup_status)

    now = time.monotonic()
    key = (filial_id or "", status_cache_key)
    if not refresh and key in _movements_cache:
        full_list, expiry = _movements_cache[key]
        if now < expiry:
            return _slice_movements_response(db, full_list, wms_status_key, offset, limit)
        del _movements_cache[key]

    try:
        full_list = await asyncio.to_thread(
            _fetch_movements_sync,
            filial_id,
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
