"""Biznes-vaqt (ish soatlari) hisobi — davomiylikni faqat smena oynasi ichida sanaydi.

Tungi smena yo'q; kechqurun biriktirilib ertalab yuborilgan buyurtmadagi tun —
o'lik vaqt bo'lib, unumdorlik hisobiga kirmasligi kerak.

Smena jadvali:
  Dushanba–Juma: 09:00–18:00
  Shanba:        09:00–15:00
  Yakshanba:     dam (0)

Vaqt zonasi `WMS_BUSINESS_TIMEZONE` (standart Asia/Tashkent, UTC+5).
"""
from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# weekday(): 0=Dushanba ... 6=Yakshanba. (start_hour, end_hour) yoki None (dam).
WORK_HOURS: dict[int, tuple[int, int] | None] = {
    0: (9, 18),
    1: (9, 18),
    2: (9, 18),
    3: (9, 18),
    4: (9, 18),
    5: (9, 15),
    6: None,
}


def _business_tz():
    key = os.getenv("WMS_BUSINESS_TIMEZONE", "Asia/Tashkent")
    try:
        return ZoneInfo(key)
    except ZoneInfoNotFoundError:
        # Windows dev (tzdata yo'q); O'zbekiston doimiy UTC+5.
        if key in ("Asia/Tashkent", "Asia/Samarkand"):
            return timezone(timedelta(hours=5), name=key)
        raise


BUSINESS_TZ = _business_tz()


def day_bounds_in_tz(day: date) -> tuple[datetime, datetime]:
    """Kalendar kunning biznes-tz dagi boshi va oxiri (DB solishtirish uchun aware).

    Sana filtri UTC bo'yicha kesilsa, kechqurun yakunlangan hujjat ertangi kunga
    tushib qoladi — shuning uchun chegara ombor vaqtida olinadi.
    """
    start = datetime.combine(day, time.min, tzinfo=BUSINESS_TZ)
    end = datetime.combine(day, time.max, tzinfo=BUSINESS_TZ)
    return start, end


def business_seconds(start: datetime | None, end: datetime | None) -> float:
    """`start` va `end` orasidagi faqat ish oynasiga tushgan soniyalar (biznes-tz)."""
    if start is None or end is None:
        return 0.0
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    s = start.astimezone(BUSINESS_TZ)
    e = end.astimezone(BUSINESS_TZ)
    if e <= s:
        return 0.0

    total = 0.0
    day = s.date()
    last_day = e.date()
    while day <= last_day:
        window = WORK_HOURS.get(day.weekday())
        if window is not None:
            w_start = datetime.combine(day, time(hour=window[0]), tzinfo=BUSINESS_TZ)
            w_end = datetime.combine(day, time(hour=window[1]), tzinfo=BUSINESS_TZ)
            overlap_start = max(s, w_start)
            overlap_end = min(e, w_end)
            if overlap_end > overlap_start:
                total += (overlap_end - overlap_start).total_seconds()
        day += timedelta(days=1)
    return total
