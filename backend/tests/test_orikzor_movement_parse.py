"""O'rikzor movement$export parse — SmartUp maydonlari import uchun."""
from __future__ import annotations

import json
from datetime import date

from app.integrations.smartup.orikzor import _parse_movement_response


def test_parse_orikzor_movement_maps_smartup_fields() -> None:
    body = json.dumps(
        {
            "movement": [
                {
                    "movement_id": "OZ-1",
                    "movement_number": "OZ-100",
                    "external_id": "ext-orikzor-1",
                    "status": "N",
                    "from_warehouse_code": "WH-A",
                    "to_warehouse_code": "777",
                    "note": "Ichki ko'chirish",
                    "amount": "1 500,50",
                    "from_movement_date": "01.06.2026",
                    "movement_items": [{"product_code": "P1", "quantity": 2, "product_article_code": "Art-1"}],
                }
            ]
        }
    )
    begin = date(2026, 6, 1)
    end = date(2026, 6, 30)
    result = _parse_movement_response(body, begin_date=begin, end_date=end)
    assert len(result.items) == 1
    order = result.items[0]
    assert order.external_id == "ext-orikzor-1"
    assert order.order_no == "OZ-100"
    assert order.status == "N"
    assert order.from_warehouse_code == "WH-A"
    assert order.to_warehouse_code == "777"
    assert order.note == "Ichki ko'chirish"
    assert order.total_amount is not None
    assert float(order.total_amount) == 1500.50
    assert order.delivery_date is not None
    assert len(order.lines) == 1
    assert order.lines[0].sku == "P1"
