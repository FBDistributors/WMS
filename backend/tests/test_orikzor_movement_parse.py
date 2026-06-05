"""O'rikzor movement$export parse — SmartUp maydonlari import uchun."""
from __future__ import annotations

import json
from datetime import date

from app.integrations.smartup.orikzor import _parse_movement_response


def _movement_body(*, status: str, to_warehouse: str, movement_id: str = "OZ-1") -> str:
    return json.dumps(
        {
            "movement": [
                {
                    "movement_id": movement_id,
                    "movement_number": "OZ-100",
                    "external_id": f"ext-{movement_id}",
                    "status": status,
                    "from_warehouse_code": "001",
                    "to_warehouse_code": to_warehouse,
                    "note": "Ichki ko'chirish",
                    "amount": "1 500,50",
                    "from_movement_date": "01.06.2026",
                    "movement_items": [
                        {"product_code": "P1", "quantity": 2, "product_article_code": "Art-1"}
                    ],
                }
            ]
        }
    )


def test_parse_orikzor_movement_maps_smartup_fields() -> None:
    body = _movement_body(status="S", to_warehouse="777")
    begin = date(2026, 6, 1)
    end = date(2026, 6, 30)
    result = _parse_movement_response(body, begin_date=begin, end_date=end)
    assert len(result.items) == 1
    order = result.items[0]
    assert order.external_id == "ext-OZ-1"
    assert order.order_no == "OZ-100"
    assert order.status == "S"
    assert order.from_warehouse_code == "001"
    assert order.to_warehouse_code == "777"
    assert order.note == "Ichki ko'chirish"
    assert order.total_amount is not None
    assert float(order.total_amount) == 1500.50
    assert order.delivery_date is not None
    assert len(order.lines) == 1
    assert order.lines[0].sku == "P1"


def test_parse_orikzor_skips_non_s_status() -> None:
    body = _movement_body(status="W", to_warehouse="777", movement_id="OZ-W")
    result = _parse_movement_response(
        body, begin_date=date(2026, 6, 1), end_date=date(2026, 6, 30)
    )
    assert len(result.items) == 0
    assert result.debug_skipped_by_reason["status_not_allowed"] == 1


def test_parse_orikzor_skips_wrong_to_warehouse() -> None:
    body = _movement_body(status="S", to_warehouse="004", movement_id="OZ-004")
    result = _parse_movement_response(
        body, begin_date=date(2026, 6, 1), end_date=date(2026, 6, 30)
    )
    assert len(result.items) == 0
    assert result.debug_skipped_by_reason["to_warehouse_not_777"] == 1
