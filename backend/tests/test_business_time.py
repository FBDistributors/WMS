"""Biznes-vaqt hisobi: tun/dam kunlar chiqariladi, shanba qisqa kun."""
from datetime import datetime

from app.core.business_time import BUSINESS_TZ, business_seconds


def _dt(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=BUSINESS_TZ)


def test_same_day_within_window():
    # 2026-06-08 Dushanba, 10:00 -> 11:30 = 1.5 soat
    assert business_seconds(_dt(2026, 6, 8, 10, 0), _dt(2026, 6, 8, 11, 30)) == 90 * 60


def test_clips_to_window_start_and_end():
    # 08:00 -> 19:00, oyna 09–18 = 9 soat
    assert business_seconds(_dt(2026, 6, 8, 8, 0), _dt(2026, 6, 8, 19, 0)) == 9 * 3600


def test_overnight_excluded():
    # Dushanba 17:00 -> Seshanba 10:00: 17-18 (1 soat) + 09-10 (1 soat) = 2 soat, tun chiqadi
    assert business_seconds(_dt(2026, 6, 8, 17, 0), _dt(2026, 6, 9, 10, 0)) == 2 * 3600


def test_sunday_is_off():
    # 2026-06-14 Yakshanba — butunlay dam
    assert business_seconds(_dt(2026, 6, 14, 9, 0), _dt(2026, 6, 14, 18, 0)) == 0.0
    # Shanba 14:00 -> Yakshanba 12:00: faqat shanba 14-15 (1 soat), yakshanba 0
    assert business_seconds(_dt(2026, 6, 13, 14, 0), _dt(2026, 6, 14, 12, 0)) == 3600


def test_saturday_short_day():
    # 2026-06-13 Shanba, oyna 09–15. 13:00 -> 17:00 = 13-15 (2 soat)
    assert business_seconds(_dt(2026, 6, 13, 13, 0), _dt(2026, 6, 13, 17, 0)) == 2 * 3600


def test_non_positive_and_none():
    assert business_seconds(None, _dt(2026, 6, 8, 10, 0)) == 0.0
    assert business_seconds(_dt(2026, 6, 8, 11, 0), _dt(2026, 6, 8, 10, 0)) == 0.0


def test_before_and_after_hours_zero():
    # 20:00 -> 22:00 ish tashqarisi
    assert business_seconds(_dt(2026, 6, 8, 20, 0), _dt(2026, 6, 8, 22, 0)) == 0.0
