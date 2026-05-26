import json
from pathlib import Path

from app.integrations.smartup.mfm_movement import (
    _filter_mfm_movement_rows_for_export,
    _parse_mfm_response,
    export_mfm_movements_for_sync,
)
from app.integrations.smartup.movement_rows import extract_movement_rows, movement_delivery_datetime
from app.integrations.smartup.schemas import SmartupOrder, SmartupOrderExportResponse


FIXTURES = Path(__file__).parent / "fixtures"


def test_smartup_order_export_response_accepts_items_kwarg() -> None:
    order = SmartupOrder(
        external_id="mfm:1",
        deal_id="1",
        order_no="1",
        status="imported",
        lines=[{"sku": "A", "name": "Item", "quantity": 1}],
    )
    resp = SmartupOrderExportResponse(order=[order])
    assert len(resp.items) == 1


def test_extract_movement_rows_from_movement_key() -> None:
    body = (FIXTURES / "mfm_movement_sample.json").read_text(encoding="utf-8")
    data = json.loads(body)
    rows, source = extract_movement_rows(data)
    assert len(rows) == 1
    assert source == "movement"
    assert rows[0]["movement_id"] == "MV-1001"


def test_parse_mfm_response_movement_level() -> None:
    body = (FIXTURES / "mfm_movement_sample.json").read_text(encoding="utf-8")
    result = _parse_mfm_response(body)
    assert len(result.items) == 1
    order = result.items[0]
    assert order.external_id == "mfm:MV-1001"
    assert order.status == "W"
    assert order.from_warehouse_code == "WH-A"
    assert order.to_warehouse_code == "WH-B"
    assert order.delivery_date is not None


def test_filter_mfm_orders_for_diller_w_sync_strict_w() -> None:
    from app.integrations.smartup.mfm_movement import filter_mfm_orders_for_diller_w_sync
    from app.integrations.smartup.schemas import SmartupOrder

    items = [
        SmartupOrder(external_id="a", deal_id="1", order_no="1", status="W", lines=[]),
        SmartupOrder(external_id="b", deal_id="2", order_no="2", status="C", lines=[]),
        SmartupOrder(external_id="c", deal_id="3", order_no="3", status="B#W", lines=[]),
        SmartupOrder(external_id="d", deal_id="4", order_no="4", status=None, lines=[]),
    ]
    kept, filtered = filter_mfm_orders_for_diller_w_sync(items)
    assert len(kept) == 1
    assert kept[0].external_id == "a"
    assert filtered == 3


def test_filter_mfm_rows_keeps_w_skips_other_statuses(monkeypatch) -> None:
    monkeypatch.setenv("SMARTUP_MFM_POST_FETCH_STATUS_FILTER", "true")
    rows = [
        {"movement_id": "1", "status": "W"},
        {"movement_id": "2", "status": "C"},
        {"movement_id": "3", "status": "B#W"},
    ]
    kept, skipped = _filter_mfm_movement_rows_for_export(rows)
    assert len(kept) == 2
    assert skipped == 1


def test_parse_mfm_response_filters_non_w_rows(monkeypatch) -> None:
    monkeypatch.setenv("SMARTUP_MFM_POST_FETCH_STATUS_FILTER", "true")
    body = json.dumps(
        {
            "movement": [
                {
                    "movement_id": "OK",
                    "status": "W",
                    "movement_items": [{"product_code": "A", "quantity": 1}],
                },
                {
                    "movement_id": "SKIP",
                    "status": "C",
                    "movement_items": [{"product_code": "B", "quantity": 1}],
                },
            ]
        }
    )
    result = _parse_mfm_response(body)
    assert len(result.items) == 1
    assert result.items[0].deal_id == "OK"


def test_parse_mfm_movement_level_preserves_raw_smartup_status() -> None:
    body = json.dumps(
        {
            "movement": [
                {
                    "movement_id": "MV-BW",
                    "status": "B#W",
                    "movement_items": [{"product_code": "P1", "quantity": 1}],
                }
            ]
        }
    )
    result = _parse_mfm_response(body)
    assert len(result.items) == 1
    assert result.items[0].status == "B#W"


def test_extract_nested_response_wrapper() -> None:
    data = {
        "response": {
            "movement": [
                {
                    "movement_id": "MV-2002",
                    "movement_items": [{"product_code": "P1", "quantity": 1}],
                }
            ]
        }
    }
    rows, source = extract_movement_rows(data)
    assert len(rows) == 1
    assert source in ("response.movement", "known_key")
    assert rows[0]["movement_id"] == "MV-2002"


def test_movement_delivery_datetime_prefers_delivery_date() -> None:
    row = {"delivery_date": "01.04.2026", "created_on": "15.03.2026"}
    dt = movement_delivery_datetime(row)
    assert dt is not None
    assert dt.day == 1
    assert dt.month == 4


def test_export_mfm_movements_for_sync_retries_modes(monkeypatch) -> None:
    calls: list[str | None] = []

    def fake_export(begin, end, filial_id=None, date_filter_mode_override=None, **kwargs):
        calls.append(date_filter_mode_override)
        if date_filter_mode_override == "created":
            order = SmartupOrder(
                external_id="mfm:1",
                deal_id="1",
                order_no="1",
                status="imported",
                lines=[{"sku": "A", "name": "Item", "quantity": 1}],
            )
            return SmartupOrderExportResponse(order=[order])
        return SmartupOrderExportResponse(order=[])

    monkeypatch.setenv("SMARTUP_MFM_DATE_FILTER_MODE", "modified")
    monkeypatch.setattr(
        "app.integrations.smartup.mfm_movement.export_mfm_movements",
        fake_export,
    )
    monkeypatch.setattr(
        "app.integrations.smartup.mfm_movement._mfm_movement_export_omit_dates",
        lambda: False,
    )
    from datetime import date

    resp, mode = export_mfm_movements_for_sync(date(2026, 1, 1), date(2026, 5, 1))
    assert len(resp.items) == 1
    assert mode == "created"
    assert calls == [None, "created"]


def test_parse_mfm_movement_level_dedupe_same_external_id() -> None:
    body = json.dumps(
        {
            "movement": [
                {
                    "movement_id": "M1",
                    "external_id": "EXT-SAME",
                    "movement_items": [{"product_code": "A", "quantity": 1}],
                },
                {
                    "movement_id": "M2",
                    "external_id": "EXT-SAME",
                    "movement_items": [{"product_code": "B", "quantity": 2}],
                },
            ]
        }
    )
    result = _parse_mfm_response(body)
    assert len(result.items) == 1
    assert len(result.items[0].lines) == 2


def test_parse_mfm_flat_group_by_delivery_number_first(monkeypatch) -> None:
    monkeypatch.setenv("SMARTUP_MFM_FLAT_GROUP_BY_KEYS", "delivery_number,movement_id")
    body = json.dumps(
        {
            "movement": [
                {
                    "movement_id": "94919",
                    "movement_unit_id": "u1",
                    "delivery_number": "DEL-99",
                    "product_code": "X",
                    "quantity": 1,
                },
                {
                    "movement_id": "94920",
                    "movement_unit_id": "u2",
                    "delivery_number": "DEL-99",
                    "product_code": "Y",
                    "quantity": 2,
                },
            ]
        }
    )
    result = _parse_mfm_response(body)
    assert len(result.items) == 1
    assert result.items[0].delivery_number == "DEL-99"
    assert len(result.items[0].lines) == 2


def test_parse_mfm_flat_rows_to_filial_code() -> None:
    body = json.dumps(
        {
            "movement": [
                {
                    "movement_id": "MV-FIL",
                    "movement_unit_id": "U1",
                    "to_filial_code": "3964966",
                    "product_code": "SKU-X",
                    "quantity": 1,
                },
            ]
        }
    )
    result = _parse_mfm_response(body)
    assert len(result.items) == 1
    assert result.items[0].filial_id == "3964966"
    assert result.items[0].to_warehouse_code is None


def test_parse_mfm_movement_level_to_filial_code_postman() -> None:
    """Postman movement$export: to_filial_code = org id; warehouse codes alohida."""
    body = json.dumps(
        {
            "movement": [
                {
                    "from_filial_code": "3788131",
                    "from_warehouse_code": "001",
                    "to_filial_code": "3964966",
                    "to_warehouse_code": None,
                    "movement_id": "712945",
                    "delivery_number": "92713",
                    "status": "C",
                    "note": "Заказ Дилер Ипподром",
                    "movement_items": [
                        {"product_code": "SKU-1", "quantity": 1},
                    ],
                },
            ]
        }
    )
    result = _parse_mfm_response(body)
    assert len(result.items) == 1
    order = result.items[0]
    assert order.filial_id == "3964966"
    assert order.from_warehouse_code == "001"
    assert order.to_warehouse_code is None


def test_parse_mfm_flat_rows() -> None:
    body = json.dumps(
        {
            "movement": [
                {
                    "movement_id": "MV-3003",
                    "movement_unit_id": "U1",
                    "product_code": "SKU-FLAT",
                    "quantity": 2,
                    "created_on": "10.02.2026",
                },
                {
                    "movement_id": "MV-3003",
                    "movement_unit_id": "U2",
                    "product_code": "SKU-FLAT-2",
                    "quantity": 3,
                },
            ]
        }
    )
    result = _parse_mfm_response(body)
    assert len(result.items) == 1
    assert len(result.items[0].lines) == 2
    assert result.items[0].status in (None, "")
    assert result.items[0].delivery_date is not None
