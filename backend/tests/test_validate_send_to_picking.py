"""Send-to-picking: strict insufficient stock (409) and batch validate endpoint."""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.document import Document
from app.models.location import Location
from app.models.order import Order, OrderLine, OrderWmsState
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.auth.security import get_password_hash


def _mk_admin(db: Session) -> User:
    u = User(
        username=f"adm-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _mk_picker(db: Session) -> User:
    u = User(
        username=f"pick-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _seed_product_with_stock(db: Session, *, sku: str, qty: Decimal) -> Product:
    product = Product(
        external_source="test",
        external_id=f"prod-{uuid.uuid4().hex[:8]}",
        name="Val Product",
        sku=sku,
        is_active=True,
    )
    db.add(product)
    db.flush()
    loc = Location(
        code=f"V-{uuid.uuid4().hex[:6]}",
        barcode_value=f"V-{uuid.uuid4().hex[:6]}",
        name="Val bin",
        type="bin",
        is_active=True,
    )
    db.add(loc)
    db.flush()
    lot = StockLot(product_id=product.id, batch="B1", expiry_date=None)
    db.add(lot)
    db.flush()
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=qty,
            movement_type="receipt",
        )
    )
    db.commit()
    db.refresh(product)
    return product


def _order_imported(db: Session, *, lines: list[OrderLine]) -> Order:
    order = Order(
        source="test",
        source_external_id=f"ext-{uuid.uuid4().hex[:12]}",
        order_number=f"ON-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = lines
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def test_send_to_picking_insufficient_stock_409_no_document(client: TestClient, db_session: Session) -> None:
    admin = _mk_admin(db_session)
    picker = _mk_picker(db_session)
    p = _seed_product_with_stock(db_session, sku=f"SKU-V-{uuid.uuid4().hex[:6]}", qty=Decimal("10"))

    order = _order_imported(
        db_session,
        lines=[
            OrderLine(sku=p.sku, name="OK line", qty=1.0, uom="dona"),
            OrderLine(sku="UNKNOWN-SKU-NO-PRODUCT", name="Bad line", qty=5.0, uom="dona"),
        ],
    )

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert res.status_code == 409
    body = res.json()
    detail = body.get("detail")
    assert isinstance(detail, dict)
    assert detail.get("code") == "INSUFFICIENT_STOCK"
    assert detail.get("order_id") == str(order.id)
    shorts = detail.get("shortages") or []
    assert len(shorts) >= 1
    assert any((s.get("sku") == "UNKNOWN-SKU-NO-PRODUCT" or s.get("required_qty", 0) >= 5) for s in shorts)

    n_so = (
        db_session.query(Document)
        .filter(Document.order_id == order.id, Document.doc_type == "SO", Document.status != "cancelled")
        .count()
    )
    assert n_so == 0


def test_validate_send_to_picking_mixed_ok_false_one_failure(client: TestClient, db_session: Session) -> None:
    admin = _mk_admin(db_session)
    p = _seed_product_with_stock(db_session, sku=f"SKU-G-{uuid.uuid4().hex[:6]}", qty=Decimal("100"))

    good = _order_imported(
        db_session,
        lines=[OrderLine(sku=p.sku, name="G", qty=2.0, uom="dona")],
    )
    bad = _order_imported(
        db_session,
        lines=[OrderLine(sku="NO-SUCH", name="B", qty=1.0, uom="dona")],
    )

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            "/api/v1/orders/validate-send-to-picking",
            json={"order_ids": [str(good.id), str(bad.id)]},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is False
    fails = data["failures"]
    assert len(fails) == 1
    assert fails[0]["order_id"] == str(bad.id)
    assert fails[0]["code"] == "insufficient_stock"
    assert len(fails[0].get("shortages") or []) >= 1


def test_validate_send_to_picking_all_ok(client: TestClient, db_session: Session) -> None:
    admin = _mk_admin(db_session)
    p = _seed_product_with_stock(db_session, sku=f"SKU-A-{uuid.uuid4().hex[:6]}", qty=Decimal("50"))

    o1 = _order_imported(db_session, lines=[OrderLine(sku=p.sku, name="L1", qty=1.0, uom="dona")])
    o2 = _order_imported(db_session, lines=[OrderLine(sku=p.sku, name="L2", qty=2.0, uom="dona")])

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            "/api/v1/orders/validate-send-to-picking",
            json={"order_ids": [str(o1.id), str(o2.id)]},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert res.status_code == 200
    assert res.json()["ok"] is True
    assert res.json()["failures"] == []
