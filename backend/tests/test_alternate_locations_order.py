"""Muqobil joylar va ajratish: bir xil muddatda eng kam qoldiq tartibi."""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.location import Location
from app.models.order import Order, OrderLine, OrderWmsState
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.auth.security import get_password_hash


def _mk_user(db: Session, *, username: str, role: str) -> User:
    user = User(
        username=username,
        password_hash=get_password_hash("testpass123"),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _seed_two_location_order(
    db: Session,
    *,
    qty_small: Decimal = Decimal("8"),
    qty_large: Decimal = Decimal("50"),
    order_qty: float = 5.0,
) -> tuple[Order, User, Product, Location, Location, StockLot]:
    picker = _mk_user(db, username=f"picker-alt-{uuid.uuid4().hex[:8]}", role="picker")
    product = Product(
        external_source="test",
        external_id=f"ext-alt-{uuid.uuid4()}",
        name="Alt Loc Product",
        sku=f"SKU-ALT-{uuid.uuid4().hex[:8]}",
        is_active=True,
    )
    db.add(product)
    db.flush()

    loc_small = Location(
        code=f"ZZ-ALT-{uuid.uuid4().hex[:4]}",
        barcode_value=f"ZZ-ALT-{uuid.uuid4().hex[:4]}",
        name="Small qty",
        type="bin",
        is_active=True,
    )
    loc_large = Location(
        code=f"AA-ALT-{uuid.uuid4().hex[:4]}",
        barcode_value=f"AA-ALT-{uuid.uuid4().hex[:4]}",
        name="Large qty",
        type="bin",
        is_active=True,
    )
    db.add_all([loc_small, loc_large])
    db.flush()

    expiry = date.today() + timedelta(days=90)
    lot = StockLot(product_id=product.id, batch="ALT-B1", expiry_date=expiry)
    db.add(lot)
    db.flush()

    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc_large.id,
            qty_change=qty_large,
            movement_type="receipt",
        )
    )
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc_small.id,
            qty_change=qty_small,
            movement_type="receipt",
        )
    )

    order = Order(
        source="test",
        source_external_id=f"order-alt-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-ALT-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = [
        OrderLine(
            sku=product.sku,
            name="Alt loc line",
            qty=order_qty,
            uom="dona",
        )
    ]
    db.add(order)
    db.commit()
    db.refresh(order)
    return order, picker, product, loc_small, loc_large, lot


def _send_to_picking(client: TestClient, db: Session, order_id: UUID, picker_id: UUID) -> UUID:
    admin = _mk_user(db, username=f"adm-alt-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            f"/api/v1/orders/{order_id}/send-to-picking",
            json={"assigned_to_user_id": str(picker_id)},
        )
        assert res.status_code == 200, res.text
        return UUID(res.json()["pick_task_id"])
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_allocate_picks_min_qty_location(client: TestClient, db_session: Session) -> None:
    order, picker, _product, loc_small, _loc_large, _lot = _seed_two_location_order(db_session)
    _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        docs = client.get("/api/v1/picking/documents")
        assert docs.status_code == 200, docs.text
        doc_id = docs.json()[0]["id"]
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
        assert doc.status_code == 200, doc.text
        line = doc.json()["lines"][0]
        assert line["location_code"] == loc_small.code
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_alternate_locations_min_qty_order(client: TestClient, db_session: Session) -> None:
    order, picker, _product, loc_small, loc_large, _lot = _seed_two_location_order(db_session)
    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
        assert doc.status_code == 200, doc.text
        alts = doc.json()["lines"][0].get("alternate_locations") or []
        assert len(alts) >= 2

        primary = alts[0]
        assert primary.get("is_primary") is True
        assert primary.get("location_code") == loc_small.code

        non_primary = [a for a in alts if not a.get("is_primary")]
        qtys = [float(a["available_qty"]) for a in non_primary]
        assert qtys == sorted(qtys)
        assert loc_large.code in {a["location_code"] for a in non_primary}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
