"""Tashkiliy harakatlar (cross-organizational movement) API — Smartup movement$export proxy."""

from __future__ import annotations

import asyncio
import time
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.integrations.smartup.mfm_movement import fetch_mfm_movements_raw
from app.models.document import Document as DocumentModel
from app.models.order import Order as OrderModel

router = APIRouter()

# Cache: key = (begin, end, filial_id, begin_mod?, end_mod?), value = (full_list, expiry). TTL 15 min.
_movements_cache: dict[tuple, tuple[list[Any], float]] = {}
_CACHE_TTL_SEC = 900


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


def _fetch_movements_sync(
    begin: date,
    end: date,
    filial_id: str | None,
    begin_modified_on: date | None = None,
    end_modified_on: date | None = None,
) -> list[Any]:
    """Smartup dan to'liq ro'yxatni oladi (bloklovchi — thread da chaqiriladi). modified_on orqali delta.
    Faqat status == 'N' (yangi) bo'lgan harakatlar qaytariladi."""
    raw = fetch_mfm_movements_raw(
        begin_date=begin,
        end_date=end,
        filial_id=filial_id,
        begin_modified_on=begin_modified_on,
        end_modified_on=end_modified_on,
    )
    movement_list = raw.get("movement") if isinstance(raw.get("movement"), list) else []
    return [
        m for m in movement_list
        if isinstance(m, dict) and (str(m.get("status") or "").strip().upper() == "N")
    ]


def _get_cached_movements(begin: date, end: date, filial_id: str | None) -> list[Any]:
    """Cache yoki Smartup; caller slice qiladi."""
    now = time.monotonic()
    key = (begin, end, filial_id)
    if key in _movements_cache:
        full_list, expiry = _movements_cache[key]
        if now < expiry:
            return full_list
        del _movements_cache[key]
    full_list = _fetch_movements_sync(begin, end, filial_id)
    _movements_cache[key] = (full_list, now + _CACHE_TTL_SEC)
    return full_list


def _get_sent_movement_ids(db: Session) -> set[str]:
    """Yig'uvchiga yuborilgan (Order + SO Document bor) harakatlarning movement_id larini qaytaradi."""
    rows = (
        db.query(OrderModel.source_external_id)
        .join(DocumentModel, DocumentModel.order_id == OrderModel.id)
        .filter(
            DocumentModel.doc_type == "SO",
            OrderModel.source_external_id.isnot(None),
            OrderModel.source_external_id.like("movement:%"),
        )
        .distinct()
        .all()
    )
    out: set[str] = set()
    for (ext_id,) in rows:
        if ext_id and ext_id.startswith("movement:"):
            out.add(ext_id[9:].strip())
    return out


def _movement_id_from_display(m: dict[str, Any]) -> str:
    """Harakat ob'ektidan movement_id ni oladi (Smartup mfm formatida)."""
    return str(m.get("movement_id") or m.get("movement_number") or "").strip()


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
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:read")),
) -> dict[str, Any]:
    """
    Proxy to Smartup mfm movement$export. Returns "movement" (sliced) and "total".
    Yig'uvchiga yuborilgan harakatlar jadvalda ko'rsatilmaydi.
    begin_modified_on/end_modified_on berilsa faqat o'zgarishlar yuklanadi (delta sync).
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

    now = time.monotonic()
    key = (begin, end, filial_id, begin_mod, end_mod)
    sent_ids = _get_sent_movement_ids(db)

    if key in _movements_cache:
        full_list, expiry = _movements_cache[key]
        if now < expiry:
            full_list = [m for m in full_list if _movement_id_from_display(m) not in sent_ids]
            total = len(full_list)
            chunk = full_list[offset : offset + limit]
            return {"movement": chunk, "total": total}
        del _movements_cache[key]

    try:
        full_list = await asyncio.to_thread(
            _fetch_movements_sync, begin, end, filial_id, begin_mod, end_mod
        )
        _movements_cache[key] = (full_list, now + _CACHE_TTL_SEC)
    except RuntimeError as exc:
        msg = str(exc)
        if "400" in msg or "не найдена" in msg or "organization" in msg.lower():
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=500, detail=msg) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Smartup movement export failed: {exc}") from exc

    full_list = [m for m in full_list if _movement_id_from_display(m) not in sent_ids]
    total = len(full_list)
    chunk = full_list[offset : offset + limit]
    return {"movement": chunk, "total": total}
