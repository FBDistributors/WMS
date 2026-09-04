"""Umumiy sozlamalar: sotuv muddat chegarasi va EXPIRED zona qoidasi.

Sotuv muddat chegarasi: muddati shu sanadan OLDIN tugaydigan lotlar oddiy
sotuvga chiqmaydi (ajratish tanlamaydi, muqobil joy sifatida taklif qilinmaydi).
None — qoida o'chiq. Promo/aksiya kanali chegaraga bo'ysunmaydi.

EXPIRED zona oddiy buyurtmalarda: yoqilsa oddiy qatorlar ham EXPIRED zonadagi
zaxiradan ajratiladi (NORMAL'dan oldin — qisqa muddatli tezroq chiqsin). Muddati
o'tgan tovar baribir chiqmaydi: promo'dan farqli, bu yerda muddat poli saqlanadi,
VIP talabi ham kuchida.

Ikki sozlama BIR-BIRINI TO'LDIRADI: chegara NORMAL zonadagi qisqa muddatlini
ushlab turadi, EXPIRED sozlamasi esa aynan o'sha zonani ataylab ochadi. Shuning
uchun chegara EXPIRED zonaga qo'llanmaydi — aks holda ikkovi bir-birini bekor
qilar va sozlama hech qachon ishlamas edi.
"""
from __future__ import annotations

from datetime import date
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.app_setting import AppSetting

SALE_EXPIRY_CUTOFF_KEY = "sale_expiry_cutoff"
EXPIRED_ZONE_IN_REGULAR_ORDERS_KEY = "expired_zone_in_regular_orders"


def _get_raw(db: Session, key: str) -> Optional[str]:
    row = db.get(AppSetting, key)
    value = (row.value or "").strip() if row else ""
    return value or None


def _set_raw(db: Session, key: str, value: Optional[str], updated_by_user_id: Optional[UUID]) -> None:
    """Qiymatni saqlash (commit chaqiruvchida)."""
    row = db.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    row.updated_by_user_id = updated_by_user_id


def _get_bool(db: Session, key: str) -> bool:
    """Bool sozlama; qiymat yo'q yoki tushunarsiz bo'lsa — False (o'chiq)."""
    raw = (_get_raw(db, key) or "").lower()
    return raw in ("1", "true", "yes", "on")


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
    _set_raw(
        db,
        SALE_EXPIRY_CUTOFF_KEY,
        cutoff.isoformat() if cutoff else None,
        updated_by_user_id,
    )


def get_expired_zone_in_regular_orders(db: Session) -> bool:
    """Oddiy buyurtmalar EXPIRED zonadan ham ajratilsinmi (default: yo'q).

    Yoqilganda sotuv muddat chegarasi shu zonaga qo'llanmaydi (modul izohiga qarang).
    """
    return _get_bool(db, EXPIRED_ZONE_IN_REGULAR_ORDERS_KEY)


def set_expired_zone_in_regular_orders(
    db: Session, enabled: bool, updated_by_user_id: Optional[UUID]
) -> None:
    """Qoidani yoqish/o'chirish. Commit chaqiruvchida."""
    _set_raw(
        db,
        EXPIRED_ZONE_IN_REGULAR_ORDERS_KEY,
        "true" if enabled else "false",
        updated_by_user_id,
    )


def effective_min_expiry(*candidates: Optional[date]) -> Optional[date]:
    """Bir nechta minimal-muddat talabidan eng qattig'i (max); hammasi None — None."""
    present = [c for c in candidates if c is not None]
    return max(present) if present else None
