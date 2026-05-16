"""Tashkiliy harakatlar ro'yxati: faqat status=W."""

from app.api.v1.endpoints.orders import _resolve_diller_list_status_filter


def test_diller_list_status_w_strict() -> None:
    assert _resolve_diller_list_status_filter("diller", "W", ["W", "imported"]) == ["W"]
    assert _resolve_diller_list_status_filter("diller", "w", ["imported", "W"]) == ["W"]


def test_diller_list_other_source_unchanged() -> None:
    assert _resolve_diller_list_status_filter("smartup", "imported", ["imported"]) == ["imported"]
