"""SmartUp qaytarishlar sinxroni: parse + upsert (deal_id bo'yicha) va dispatch."""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.integrations.smartup.returns_export as re_mod
from app.auth.security import get_password_hash
from app.integrations.smartup.returns_export import sync_returns
from app.models.customer_return import CUSTOMER_RETURN_STATUS_ASSIGNED, CustomerReturn
from app.models.product import Product
from app.models.smartup_return import SmartupReturn, SmartupReturnLine
from app.models.user import User


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


# --- Dispatch (yig'uvchiga yuborish) testlari ---------------------------------


def _login(client: TestClient, username: str, password: str = "testpass123") -> dict[str, str]:
    resp = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _seed_admin_and_picker(db_session: Session) -> tuple[User, User]:
    admin = User(
        username="sret_admin",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    picker = User(
        username="sret_picker",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db_session.add_all([admin, picker])
    db_session.commit()
    db_session.refresh(admin)
    db_session.refresh(picker)
    return admin, picker


def _seed_smartup_return(db_session: Session, *, codes: list[str]) -> SmartupReturn:
    ret = SmartupReturn(
        deal_id="D-DISPATCH-1",
        person_code="PC1",
        person_name="Mijoz Test",
    )
    for i, code in enumerate(codes):
        ret.lines.append(
            SmartupReturnLine(
                product_code=code,
                product_name=f"Tovar {code}",
                return_quant=Decimal("2"),
                expiry_date="2027-01",
                line_no=i + 1,
            )
        )
    db_session.add(ret)
    db_session.commit()
    db_session.refresh(ret)
    return ret


def _seed_product(db_session: Session, smartup_code: str) -> Product:
    p = Product(
        external_source="test",
        external_id=f"ext-{smartup_code}",
        name=f"WMS {smartup_code}",
        sku=f"SKU-{smartup_code}",
        smartup_code=smartup_code,
        is_active=True,
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def test_dispatch_creates_customer_return_assigned_to_picker(client, db_session):
    admin, picker = _seed_admin_and_picker(db_session)
    _seed_product(db_session, "AC0001")
    _seed_product(db_session, "AC0002")
    ret = _seed_smartup_return(db_session, codes=["AC0001", "AC0002"])
    headers = _login(client, "sret_admin")

    resp = client.post(
        f"/api/v1/smartup-returns/{ret.id}/dispatch",
        json={"picker_user_id": str(picker.id)},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == CUSTOMER_RETURN_STATUS_ASSIGNED

    cr = db_session.query(CustomerReturn).filter_by(id=uuid.UUID(body["customer_return_id"])).one()
    assert cr.status == CUSTOMER_RETURN_STATUS_ASSIGNED
    assert str(cr.assigned_picker_user_id) == str(picker.id)
    assert cr.source == "smartup"
    assert cr.customer_name == "Mijoz Test"
    assert len(cr.lines) == 2
    assert all(l.qty == Decimal("2") for l in cr.lines)

    db_session.refresh(ret)
    assert str(ret.customer_return_id) == str(cr.id)
    assert ret.wms_status == "dispatched"


def test_dispatch_blocks_when_product_unmapped(client, db_session):
    admin, picker = _seed_admin_and_picker(db_session)
    _seed_product(db_session, "AC0001")  # AC0002 mos kelmaydi
    ret = _seed_smartup_return(db_session, codes=["AC0001", "AC0002"])
    headers = _login(client, "sret_admin")

    resp = client.post(
        f"/api/v1/smartup-returns/{ret.id}/dispatch",
        json={"picker_user_id": str(picker.id)},
        headers=headers,
    )
    assert resp.status_code == 400, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "UNMAPPED_PRODUCTS"
    assert any(item["product_code"] == "AC0002" for item in detail["items"])

    db_session.refresh(ret)
    assert ret.customer_return_id is None  # hech nima yaratilmadi


def test_dispatch_twice_returns_409(client, db_session):
    admin, picker = _seed_admin_and_picker(db_session)
    _seed_product(db_session, "AC0001")
    ret = _seed_smartup_return(db_session, codes=["AC0001"])
    headers = _login(client, "sret_admin")
    ok = client.post(
        f"/api/v1/smartup-returns/{ret.id}/dispatch",
        json={"picker_user_id": str(picker.id)},
        headers=headers,
    )
    assert ok.status_code == 200, ok.text

    again = client.post(
        f"/api/v1/smartup-returns/{ret.id}/dispatch",
        json={"picker_user_id": str(picker.id)},
        headers=headers,
    )
    assert again.status_code == 409, again.text


def test_only_new_filter_hides_dispatched(client, db_session):
    admin, picker = _seed_admin_and_picker(db_session)
    _seed_product(db_session, "AC0001")
    ret = _seed_smartup_return(db_session, codes=["AC0001"])
    headers = _login(client, "sret_admin")

    inbox = client.get("/api/v1/smartup-returns", headers=headers)
    assert inbox.status_code == 200
    assert inbox.json()["total"] == 1

    client.post(
        f"/api/v1/smartup-returns/{ret.id}/dispatch",
        json={"picker_user_id": str(picker.id)},
        headers=headers,
    )

    inbox2 = client.get("/api/v1/smartup-returns", headers=headers)
    assert inbox2.json()["total"] == 0  # yuborilgan inbox'dan chiqadi
    all_rows = client.get("/api/v1/smartup-returns?only_new=false", headers=headers)
    assert all_rows.json()["total"] == 1
