"""Hujjat va buyurtma holati guruhlari — Jarayon ro'yxati, dashboard va rezerv himoyasi uchun yagona manba.

Ilgari picking.py va dashboard.py ichida lokal takrorlangan; ikkalasi mos kelmay
qolmasligi uchun shu yerga ko'chirildi.
"""
from __future__ import annotations

# Admin buyurtmani packed/shipped/cancelled qilsa — yig'uvchi va controller ro'yxatida ko'rinmasin
ORDER_HIDDEN_STATUSES: tuple[str, ...] = ("completed", "packed", "shipped", "cancelled")

# Yig'ish quvuridagi (Jarayon) buyurtma holatlari
ACTIVE_PIPELINE_ORDER_STATUSES: tuple[str, ...] = ("allocated", "picking", "picked")

# Yig'ish tugamagan — rezervi hali kerak bo'lgan SO hujjat holatlari
ACTIVE_DOCUMENT_STATUSES: tuple[str, ...] = (
    "draft",
    "confirmed",
    "new",
    "partial",
    "in_progress",
    "picked",
)
