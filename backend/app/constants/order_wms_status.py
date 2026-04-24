"""Canonical order WMS statuses (order_wms_state.status).

Legacy values B#W, B#S, ready_for_picking are normalized on write and on list filters.
SmartUp HTTP export may still use status=B#W — that is external only, not DB storage.
"""

from __future__ import annotations

CANONICAL_ORDER_WMS_STATUSES: frozenset[str] = frozenset(
    {
        "imported",
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
    if not s or s in ("B#W", "B#S"):
        return "imported"
    if s == "ready_for_picking":
        return "imported"
    if s in CANONICAL_ORDER_WMS_STATUSES:
        return s
    return "imported"


def normalize_list_status_filter_token(token: str) -> str:
    """GET /orders?status= legacy tokens → canonical token used in ORDER_STATUSES."""
    t = (token or "").strip()
    if t in ("B#S", "B#W"):
        return "imported"
    if t == "ready_for_picking":
        return "imported"
    return t
