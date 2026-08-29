"""Sotuv muddat chegarasi: qisqa muddatli lotlar oddiy sotuvga chiqmaydi.

Chegara (app_settings.sale_expiry_cutoff) sanasidan OLDIN tugaydigan lotlar:
ajratishda tanlanmaydi, muqobil joy sifatida taklif qilinmaydi. Promo/aksiya
qatorlari va chegara bo'sh holat — eskicha.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.document import Document, DocumentLine
from app.models.location import Location
from app.models.order import Order, OrderLine, OrderWmsState
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.api.v1.endpoints.picking import _line_alternate_locations
from app.services.app_settings import (
    effective_min_expiry,
    get_sale_expiry_cutoff,
    set_sale_expiry_cutoff,
)

CUTOFF = date(2027, 1, 1)
SHORT = date(2026, 11, 1)  # chegaradan oldin tugaydi
LONG = date(2027, 6, 1)  # chegaradan keyin


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: user


def _clear():
    app.dependency_overrides.pop(get_current_user, None)


def _mk_user(db: Session, role: str) -> User:
    u = User(
        username=f"{role[:4]}-exp-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role=role,
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _seed_two_lot_order(db: Session, *, line_source: str = "product"):
    """Bitta mahsulot, NORMAL zonada ikkita lot (SHORT va LONG), 2 dona buyurtma."""
    picker = _mk_user(db, "picker")
    product = Product(
        external_source="test",
        external_id=f"exp-{uuid.uuid4().hex[:8]}",
        name="Expiry Prod",
        sku=f"SKU-EXP-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db.add(product)
    db.flush()
    loc_short = Location(
        code=f"E1-{uuid.uuid4().hex[:6]}",
        barcode_value=f"E1-{uuid.uuid4().hex[:6]}",
        name="Short bin",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    loc_long = Location(
        code=f"E2-{uuid.uuid4().hex[:6]}",
        barcode_value=f"E2-{uuid.uuid4().hex[:6]}",
        name="Long bin",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    db.add_all([loc_short, loc_long])
    db.flush()
    lot_short = StockLot(product_id=product.id, batch="B-SHORT", expiry_date=SHORT)
    lot_long = StockLot(product_id=product.id, batch="B-LONG", expiry_date=LONG)
    db.add_all([lot_short, lot_long])
    db.flush()
    db.add_all(
        [
            StockMovement(
                product_id=product.id, lot_id=lot_short.id, location_id=loc_short.id,
                qty_change=Decimal("10"), movement_type="receipt",
            ),
            StockMovement(
                product_id=product.id, lot_id=lot_long.id, location_id=loc_long.id,
                qty_change=Decimal("10"), movement_type="receipt",
            ),
        ]
    )
    order = Order(
        source="test",
        source_external_id=f"exp-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-EXP-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = [
        OrderLine(sku=product.sku, name="Expiry line", qty=2.0, uom="dona", line_source=line_source)
    ]
    db.add(order)
    db.commit()
    db.refresh(order)
    return order, picker, lot_short, lot_long


def _allocate(client: TestClient, db: Session, order, picker) -> Document:
    admin = _mk_user(db, "warehouse_admin")
    _as(admin)
    try:
        resp = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        assert resp.status_code == 200, resp.text
        doc_id = resp.json()["pick_task_id"]
    finally:
        _clear()
    return db.query(Document).filter(Document.id == uuid.UUID(doc_id)).one()


# --- servis birliklari ---


def test_effective_min_expiry_takes_strictest():
    assert effective_min_expiry(None, None) is None
    assert effective_min_expiry(date(2027, 1, 1), None) == date(2027, 1, 1)
    assert effective_min_expiry(date(2027, 1, 1), date(2027, 6, 1)) == date(2027, 6, 1)


def test_cutoff_roundtrip_and_bad_value(db_session: Session):
    assert get_sale_expiry_cutoff(db_session) is None
    set_sale_expiry_cutoff(db_session, CUTOFF, None)
    db_session.commit()
    assert get_sale_expiry_cutoff(db_session) == CUTOFF
    set_sale_expiry_cutoff(db_session, None, None)
    db_session.commit()
    assert get_sale_expiry_cutoff(db_session) is None


# --- ajratish ---


def test_allocation_skips_short_lot_when_cutoff_set(client: TestClient, db_session: Session):
    order, picker, lot_short, lot_long = _seed_two_lot_order(db_session)
    set_sale_expiry_cutoff(db_session, CUTOFF, None)
    db_session.commit()

    doc = _allocate(client, db_session, order, picker)

    lots = {ln.lot_id for ln in doc.lines}
    assert lot_long.id in lots
    assert lot_short.id not in lots  # FEFO bo'yicha birinchi bo'lardi — chegara to'sdi


def test_allocation_old_behavior_without_cutoff(client: TestClient, db_session: Session):
    """Regressiya: chegara bo'sh — FEFO qisqa muddatlini birinchi oladi."""
    order, picker, lot_short, _lot_long = _seed_two_lot_order(db_session)

    doc = _allocate(client, db_session, order, picker)

    assert {ln.lot_id for ln in doc.lines} == {lot_short.id}


def test_promo_line_ignores_cutoff(client: TestClient, db_session: Session):
    """Promo (gift) qatori chegara ostidagi lotdan teraveradi — sotish kanali ochiq."""
    order, picker, lot_short, _lot_long = _seed_two_lot_order(db_session, line_source="gift")
    set_sale_expiry_cutoff(db_session, CUTOFF, None)
    db_session.commit()

    doc = _allocate(client, db_session, order, picker)

    # gift FEFO bo'yicha qisqa muddatlini oladi (EXPIRED bo'sh — NORMAL fallback).
    assert lot_short.id in {ln.lot_id for ln in doc.lines}


# --- muqobil joylar filtri (sof funksiya) ---


def _alt_row(lot_id, location_id, expiry, av=5.0):
    return {
        "lot_id": lot_id,
        "location_id": location_id,
        "location_code": "X-1",
        "available": av,
        "batch": "b",
        "expiry_date": expiry,
    }


def test_alternates_exclude_short_lots():
    line = SimpleNamespace(
        product_id=uuid.uuid4(), location_id=None, lot_id=None,
        expiry_date=LONG, location_code="", batch="b",
    )
    short_row = _alt_row(uuid.uuid4(), uuid.uuid4(), SHORT)
    long_row = _alt_row(uuid.uuid4(), uuid.uuid4(), LONG)

    out = _line_alternate_locations(
        line, [short_row, long_row], bd_map={}, primary_rows=[], sale_cutoff=CUTOFF
    )
    assert [a.lot_id for a in out] == [long_row["lot_id"]]

    # Chegara bo'sh — ikkalasi ham chiqadi.
    out = _line_alternate_locations(
        line, [short_row, long_row], bd_map={}, primary_rows=[], sale_cutoff=None
    )
    assert len(out) == 2


def test_alternates_allowed_when_line_itself_short():
    """Promo/EXPIRED'dan ajratilgan qator (o'z loti chegara ostida) o'z sinfida qoladi."""
    line = SimpleNamespace(
        product_id=uuid.uuid4(), location_id=None, lot_id=None,
        expiry_date=SHORT, location_code="", batch="b",
    )
    short_row = _alt_row(uuid.uuid4(), uuid.uuid4(), SHORT)

    out = _line_alternate_locations(
        line, [short_row], bd_map={}, primary_rows=[], sale_cutoff=CUTOFF
    )
    assert len(out) == 1


# --- sozlama API ---


def test_settings_api_roundtrip(client: TestClient, db_session: Session):
    admin = _mk_user(db_session, "warehouse_admin")
    _as(admin)
    try:
        assert client.get("/api/v1/app-settings/sale-expiry-cutoff").json()["cutoff"] is None
        resp = client.put(
            "/api/v1/app-settings/sale-expiry-cutoff", json={"cutoff": "2027-01-01"}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["cutoff"] == "2027-01-01"
        assert client.get("/api/v1/app-settings/sale-expiry-cutoff").json()["cutoff"] == "2027-01-01"
        clear = client.put("/api/v1/app-settings/sale-expiry-cutoff", json={"cutoff": None})
        assert clear.json()["cutoff"] is None
    finally:
        _clear()
