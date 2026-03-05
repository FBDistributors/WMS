"""Expiry date helpers: muddat oy bo'yicha (Yil keyin Oy). Barcha saqlash YYYY-MM-01."""

from __future__ import annotations

from datetime import date


def first_day_of_month(d: date | None) -> date | None:
    """Berilgan sanani shu oyning 1-kuniga qaytaradi. None qaytaradi."""
    if d is None:
        return None
    return d.replace(day=1)


def first_day_of_current_month() -> date:
    """Joriy oyning 1-kuni — muddati o'tganni oy bo'yicha hisoblash uchun."""
    today = date.today()
    return today.replace(day=1)


def normalize_expiry_to_first_of_month(d: date | None) -> date | None:
    """Expiry dateni oyning 1-kuniga normalizatsiya qiladi (YYYY-MM-01)."""
    return first_day_of_month(d)
