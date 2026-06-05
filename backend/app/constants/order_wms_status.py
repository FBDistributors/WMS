"""Canonical order WMS statuses (order_wms_state.status).

Legacy values B#W, B#S, ready_for_picking are normalized on write and on list filters.
SmartUp asosiy eksportdagi B#W tashqi; mfm tashkiliy harakatda yangi qatorlar DB da "W" saqlanishi mumkin.
"""

from __future__ import annotations

CANONICAL_ORDER_WMS_STATUSES: frozenset[str] = frozenset(
    {
        "imported",
        "W",  # SmartUp tashkiliy harakat (mfm) yangi qator — DB da saqlanadi
        "S",  # SmartUp O'rikzor harakati (literal Smartup status S)
        "allocated",
        "picking",
        "picked",
        "completed",
        "packed",
        "shipped",
        "cancelling_in_progress",
        "cancelled",
    }
)


def normalize_order_wms_status_for_storage(value: str | None) -> str:
    """Map SmartUp / legacy / empty to a single canonical status for DB."""
    s = (value or "").strip()
    if s.lower() == "w":
        return "W"
    if not s or s in ("B#W", "B#S"):
        return "imported"
    if s == "ready_for_picking":
        return "imported"
    if s in CANONICAL_ORDER_WMS_STATUSES:
        return s
    return "imported"


def smartup_movement_status_for_wms_storage(value: str | None) -> str:
    """
    SmartUp tashkiliy harakat qatori holati -> order_wms_state (DB).
    Sinxron: barcha holatlar saqlanadi; admin Yangi tab GET /orders?status=W bilan filtrlaydi.
    """
    s = (value or "").strip()
    if not s:
        return "W"
    ru = s.upper()
    if ru in ("W", "B#W", "N"):
        return "W"
    if ru == "C":
        return "picking"
    if ru in ("L", "P", "PICKED", "REVIEW", "CHECK"):
        return "picked"
    if ru in ("S", "B#S", "SHIPPED", "DELIVERED"):
        return "completed"
    if ru in ("A", "CANCELLED"):
        return "cancelled"
    return normalize_order_wms_status_for_storage(s)


def smartup_orikzor_status_for_wms_storage(value: str | None) -> str:
    """
    SmartUp O'rikzor harakati holati -> order_wms_state (DB).
    Smartup S/B#S literal "S" sifatida saqlanadi (completed ga map qilinmaydi).
    """
    s = (value or "").strip()
    if not s:
        return "S"
    ru = s.upper()
    if ru in ("S", "B#S"):
        return "S"
    if ru in ("A", "CANCELLED"):
        return "cancelled"
    return "S"


def normalize_list_status_filter_token(token: str) -> str:
    """GET /orders?status= legacy tokens → canonical token used in ORDER_STATUSES."""
    t = (token or "").strip()
    if t.lower() == "w":
        return "W"
    if t in ("B#S", "B#W"):
        return "imported"
    if t == "ready_for_picking":
        return "imported"
    return t
