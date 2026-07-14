"""SmartUp qaytarishlar sinxroni: parse + upsert (deal_id bo'yicha)."""
from __future__ import annotations

from decimal import Decimal

import app.integrations.smartup.returns_export as re_mod
from app.integrations.smartup.returns_export import sync_returns
from app.models.smartup_return import SmartupReturn


_SAMPLE = [
    {
        "deal_id": "258390452",
        "order_deal_id": "234812079",
        "external_id": "None",
        "booked_date": "02.07.2026",
        "deal_time": "02.07.2026 12:16:34",
        "person_code": "3535348",
        "person_name": "Дилер Янгиюль (Нодыра)",
        "person_tin": "None",
        "filial_code": "3788131",
        "return_reason_id": "3064",
        "return_reason_code": "None",
        "sales_manager_name": "NURXONOV DILMUROD",
        "total_amount": "-790900",
        "currency_code": "860",
        "status": "A",
        "note": "None",
        "return_products": [
            {"product_code": "AC0001", "product_name": "Tovar A", "return_quant": "3",
             "product_price": "10000", "expiry_date": "2027-01", "warehouse_code": "001",
             "action_name": "None"},
            {"product_code": "AC0002", "product_name": "Tovar B", "return_quant": "1.5",
             "product_price": "5000", "expiry_date": "None", "warehouse_code": "001",
             "action_name": "Aksiya X"},
        ],
    }
]


def test_sync_returns_parses_and_upserts(db_session, monkeypatch):
    monkeypatch.setattr(re_mod, "fetch_returns_raw", lambda days=30, client=None: _SAMPLE)

    result = sync_returns(db_session, days=30)
    assert result == {"fetched": 1, "created": 1, "updated": 0}

    row = db_session.query(SmartupReturn).filter_by(deal_id="258390452").one()
    assert row.person_name == "Дилер Янгиюль (Нодыра)"
    assert row.order_deal_id == "234812079"
    assert row.external_id is None  # "None" -> None
    assert row.total_amount == Decimal("-790900")
    assert row.return_reason_id == "3064"
    assert row.wms_status == "new"
    assert row.return_date is not None and row.return_date.year == 2026
    assert len(row.lines) == 2
    assert row.lines[0].return_quant == Decimal("3")
    assert row.lines[1].action_name == "Aksiya X"


def test_sync_returns_upsert_preserves_wms_status(db_session, monkeypatch):
    monkeypatch.setattr(re_mod, "fetch_returns_raw", lambda days=30, client=None: _SAMPLE)
    sync_returns(db_session, days=30)
    row = db_session.query(SmartupReturn).filter_by(deal_id="258390452").one()
    row.wms_status = "assigned"
    db_session.commit()

    # Ikkinchi sinxron — xuddi shu deal_id: update, wms_status saqlanadi.
    result = sync_returns(db_session, days=30)
    assert result["created"] == 0
    assert result["updated"] == 1
    row2 = db_session.query(SmartupReturn).filter_by(deal_id="258390452").one()
    assert row2.wms_status == "assigned"
    assert len(row2.lines) == 2  # qatorlar qayta yuklandi, dublikat yo'q
