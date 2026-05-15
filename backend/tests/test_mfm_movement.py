import json
from pathlib import Path

from app.integrations.smartup.mfm_movement import _parse_mfm_response
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
    resp = SmartupOrderExportResponse(items=[order])
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
    assert order.from_warehouse_code == "WH-A"
    assert order.to_warehouse_code == "WH-B"
    assert order.delivery_date is not None


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
    assert result.items[0].delivery_date is not None
