"""Umumiy sozlamalarni o'qish/yozish + sotuv muddat chegarasi.

Chegara: muddati shu sanadan OLDIN tugaydigan lotlar oddiy sotuvga chiqmaydi
(ajratish tanlamaydi, muqobil joy sifatida taklif qilinmaydi). None — qoida
o'chiq. Promo/aksiya kanali chegaraga bo'ysunmaydi (qisqa muddatlilarni sotish
yo'li ochiq qoladi).
"""
from __future__ import annotations

from datetime import date
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.app_setting import AppSetting

SALE_EXPIRY_CUTOFF_KEY = "sale_expiry_cutoff"


def _get_raw(db: Session, key: str) -> Optional[str]:
    row = db.get(AppSetting, key)
    value = (row.value or "").strip() if row else ""
    return value or None


def get_sale_expiry_cutoff(db: Session) -> Optional[date]:
    """Sotuv muddat chegarasi (ISO sana) yoki None (qoida o'chiq)."""
    raw = _get_raw(db, SALE_EXPIRY_CUTOFF_KEY)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        # Buzilgan qiymat qoidani jimgina yoqib/o'chirib yubormasin — o'chiq deb qaraymiz.
        return None


def set_sale_expiry_cutoff(
    db: Session, cutoff: Optional[date], updated_by_user_id: Optional[UUID]
) -> None:
    """Chegarani saqlash; None — tozalash (qoida o'chadi). Commit chaqiruvchida."""
    row = db.get(AppSetting, SALE_EXPIRY_CUTOFF_KEY)
    value = cutoff.isoformat() if cutoff else None
    if row is None:
        row = AppSetting(key=SALE_EXPIRY_CUTOFF_KEY, value=value)
        db.add(row)
    else:
        row.value = value
    row.updated_by_user_id = updated_by_user_id


def effective_min_expiry(*candidates: Optional[date]) -> Optional[date]:
    """Bir nechta minimal-muddat talabidan eng qattig'i (max); hammasi None — None."""
    present = [c for c in candidates if c is not None]
    return max(present) if present else None
