"""EXPIRED zona oddiy buyurtmalarda: sozlama yoqilganda ajratiladi.

Qoidalar (reja bo'yicha): EXPIRED NORMAL'dan OLDIN; muddat poli saqlanadi
(promo'dan farqli — muddati o'tgan tovar oddiy mijozga ketmaydi); sotuv
chegarasi va VIP talabi ustun; o'chiq bo'lsa eski xatti-harakat.
"""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1.endpoints.picking import _line_alternate_locations
from app.models.location import Location
from app.models.order import Order, OrderLine, OrderWmsState
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.services.app_settings import (
    set_expired_zone_in_regular_orders,
    set_sale_expiry_cutoff,
)
from tests.test_sale_expiry_cutoff import _allocate, _as, _clear, _mk_user

_TODAY = date.today()
#: Muddat poli — joriy oy boshi. Sinov sanalari shunga nisbatan hisoblanadi
#: (qat'iy sana yozilsa test kalendar bilan buzilardi).
FLOOR = _TODAY.replace(day=1)
SHORT_VALID = (FLOOR + timedelta(days=45)).replace(day=1)  # amaldagi, lekin yaqin
LONG = (FLOOR + timedelta(days=900)).replace(day=1)  # uzoq muddat
PAST = (FLOOR - timedelta(days=60)).replace(day=1)  # muddati o'tgan


def _seed(db: Session, *, line_source: str = "product", expired_expiry: date = SHORT_VALID):
    """NORMAL (uzoq muddat) + EXPIRED (qisqa muddat) zonalarida bittadan lot."""
    picker = _mk_user(db, "picker")
    product = Product(
        external_source="test",
        external_id=f"ez-{uuid.uuid4().hex[:8]}",
        name="Zone Prod",
        sku=f"SKU-EZ-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db.add(product)
    db.flush()
    loc_normal = Location(
        code=f"N-{uuid.uuid4().hex[:6]}",
        barcode_value=f"N-{uuid.uuid4().hex[:6]}",
        name="Normal bin",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    loc_expired = Location(
        code=f"X-{uuid.uuid4().hex[:6]}",
        barcode_value=f"X-{uuid.uuid4().hex[:6]}",
        name="Expired bin",
        type="bin",
        zone_type="EXPIRED",
        is_active=True,
    )
    db.add_all([loc_normal, loc_expired])
    db.flush()
    lot_normal = StockLot(product_id=product.id, batch="B-N", expiry_date=LONG)
    lot_expired = StockLot(product_id=product.id, batch="B-X", expiry_date=expired_expiry)
    db.add_all([lot_normal, lot_expired])
    db.flush()
    for lot, loc in ((lot_normal, loc_normal), (lot_expired, loc_expired)):
        db.add(
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=loc.id,
                qty_change=Decimal("10"),
                movement_type="receipt",
            )
        )
    order = Order(
        source="test",
        source_external_id=f"ez-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-EZ-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = [
        OrderLine(sku=product.sku, name="Zone line", qty=2.0, uom="dona", line_source=line_source)
    ]
    db.add(order)
    db.commit()
    db.refresh(order)
    return SimpleNamespace(
        order=order,
        picker=picker,
        product=product,
        lot_normal=lot_normal,
        lot_expired=lot_expired,
        loc_normal=loc_normal,
        loc_expired=loc_expired,
    )


# --- ajratish ---


def test_expired_used_first_when_enabled(client: TestClient, db_session: Session):
    s = _seed(db_session)
    set_expired_zone_in_regular_orders(db_session, True, None)
    db_session.commit()

    doc = _allocate(client, db_session, s.order, s.picker)

    assert {ln.lot_id for ln in doc.lines} == {s.lot_expired.id}


def test_only_normal_when_disabled(client: TestClient, db_session: Session):
    """Regressiya: sozlama o'chiq — hozirgi xatti-harakat (faqat NORMAL)."""
    s = _seed(db_session)

    doc = _allocate(client, db_session, s.order, s.picker)

    assert {ln.lot_id for ln in doc.lines} == {s.lot_normal.id}


def test_truly_expired_lot_never_allocated(client: TestClient, db_session: Session):
    """Yoqilgan bo'lsa ham muddat poli saqlanadi (promo'dan asosiy farq)."""
    s = _seed(db_session, expired_expiry=PAST)
    set_expired_zone_in_regular_orders(db_session, True, None)
    db_session.commit()

    doc = _allocate(client, db_session, s.order, s.picker)

    assert {ln.lot_id for ln in doc.lines} == {s.lot_normal.id}


def test_sale_cutoff_wins_over_setting(client: TestClient, db_session: Session):
    s = _seed(db_session)
    set_expired_zone_in_regular_orders(db_session, True, None)
    # Chegara EXPIRED lot muddatidan keyin — u sotuvga chiqmasligi kerak.
    set_sale_expiry_cutoff(db_session, LONG, None)
    db_session.commit()

    doc = _allocate(client, db_session, s.order, s.picker)

    assert {ln.lot_id for ln in doc.lines} == {s.lot_normal.id}


def test_promo_flow_unchanged(client: TestClient, db_session: Session):
    """Promo qatori sozlamadan qat'i nazar EXPIRED'dan (muddati o'tgani ham) oladi."""
    s = _seed(db_session, line_source="gift", expired_expiry=PAST)

    doc = _allocate(client, db_session, s.order, s.picker)

    assert {ln.lot_id for ln in doc.lines} == {s.lot_expired.id}


# --- muqobil joylar ---


def _alt_row(lot_id, location_id, zone, expiry=LONG, av=5.0):
    return {
        "lot_id": lot_id,
        "location_id": location_id,
        "location_code": "X-1",
        "zone_type": zone,
        "available": av,
        "batch": "b",
        "expiry_date": expiry,
    }


def test_alternates_hide_expired_when_disabled():
    line = SimpleNamespace(
        product_id=uuid.uuid4(),
        location_id=None,
        lot_id=None,
        expiry_date=LONG,
        location_code="",
        batch="b",
    )
    normal = _alt_row(uuid.uuid4(), uuid.uuid4(), "NORMAL")
    expired = _alt_row(uuid.uuid4(), uuid.uuid4(), "EXPIRED")

    out = _line_alternate_locations(
        line, [normal, expired], bd_map={}, primary_rows=[], allow_expired_zone=False
    )
    assert [a.lot_id for a in out] == [normal["lot_id"]]

    out = _line_alternate_locations(
        line, [normal, expired], bd_map={}, primary_rows=[], allow_expired_zone=True
    )
    assert len(out) == 2


def test_alternates_keep_expired_for_expired_line():
    """Promo qator (o'z joyi EXPIRED) sozlama o'chiq bo'lsa ham o'z sinfini ko'radi."""
    lot_id, loc_id = uuid.uuid4(), uuid.uuid4()
    line = SimpleNamespace(
        product_id=uuid.uuid4(),
        location_id=loc_id,
        lot_id=lot_id,
        expiry_date=LONG,
        location_code="",
        batch="b",
    )
    own = _alt_row(lot_id, loc_id, "EXPIRED")
    other_expired = _alt_row(uuid.uuid4(), uuid.uuid4(), "EXPIRED")

    out = _line_alternate_locations(
        line, [own, other_expired], bd_map={}, primary_rows=[], allow_expired_zone=False
    )
    assert len(out) == 2


# --- sozlama API ---


def test_setting_api_roundtrip(client: TestClient, db_session: Session):
    admin = _mk_user(db_session, "warehouse_admin")
    _as(admin)
    try:
        url = "/api/v1/app-settings/expired-zone-in-regular-orders"
        assert client.get(url).json()["enabled"] is False
        assert client.put(url, json={"enabled": True}).json()["enabled"] is True
        assert client.get(url).json()["enabled"] is True
        assert client.put(url, json={"enabled": False}).json()["enabled"] is False
        assert client.get(url).json()["enabled"] is False
    finally:
        _clear()
