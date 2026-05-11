from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.document import Document as DocumentModel
from app.models.order import Order, OrderLine, OrderWmsState
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from decimal import Decimal


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


def _seed_allocatable_order(db: Session) -> tuple[Order, User, User]:
    picker1 = _mk_user(db, username=f"picker1-{uuid.uuid4().hex[:8]}", role="picker")
    picker2 = _mk_user(db, username=f"picker2-{uuid.uuid4().hex[:8]}", role="picker")
    product = Product(
        external_source="test",
        external_id=f"prod-{uuid.uuid4().hex[:8]}",
        name="Reassign Product",
        sku=f"SKU-RS-{uuid.uuid4().hex[:8]}",
        is_active=True,
    )
    db.add(product)
    db.flush()

    from app.models.location import Location

    loc = Location(
        code=f"RS-{uuid.uuid4().hex[:8]}",
        barcode_value=f"RS-{uuid.uuid4().hex[:8]}",
        name="Reassign bin",
        type="bin",
        is_active=True,
    )
    db.add(loc)
    db.flush()

    lot = StockLot(product_id=product.id, batch="RS-BATCH", expiry_date=None)
    db.add(lot)
    db.flush()
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
        source_external_id=f"order-rs-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-RS-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = [
        OrderLine(
            sku=product.sku,
            name="Reassign line",
            qty=2.0,
            uom="dona",
        )
    ]
    db.add(order)
    db.commit()
    db.refresh(order)
    return order, picker1, picker2


def test_reassign_picker_success(client: TestClient, db_session: Session) -> None:
    admin = _mk_user(db_session, username=f"adm-rs-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order, picker1, picker2 = _seed_allocatable_order(db_session)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        r0 = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker1.id)},
        )
        assert r0.status_code == 200
        doc_id = r0.json()["pick_task_id"]

        r1 = client.post(
            f"/api/v1/orders/{order.id}/reassign-picker",
            json={"assigned_to_user_id": str(picker2.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r1.status_code == 200
    assert r1.json()["pick_task_id"] == doc_id
    assert r1.json()["assigned_to"] == str(picker2.id)

    doc = db_session.query(DocumentModel).filter(DocumentModel.id == uuid.UUID(doc_id)).one()
    assert doc.assigned_to_user_id == picker2.id


def test_reassign_picker_rejects_invalid_picker(client: TestClient, db_session: Session) -> None:
    admin = _mk_user(db_session, username=f"adm-rs2-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order, picker1, _picker2 = _seed_allocatable_order(db_session)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker1.id)},
        )
        r1 = client.post(
            f"/api/v1/orders/{order.id}/reassign-picker",
            json={"assigned_to_user_id": str(admin.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r1.status_code == 400
    assert "Invalid picker" in (r1.json().get("detail") or "")


def test_reassign_picker_rejects_after_pick(client: TestClient, db_session: Session) -> None:
    admin = _mk_user(db_session, username=f"adm-rs3-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order, picker1, picker2 = _seed_allocatable_order(db_session)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker1.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    # Refresh product sku for pick barcode
    db_session.refresh(order)
    line = order.lines[0]
    sku = line.sku or ""

    app.dependency_overrides[get_current_user] = lambda: picker1
    try:
        r_pick = client.post(
            "/api/v1/picking/consolidated/pick",
            json={"barcode": sku, "qty": 1, "request_id": f"rs-{uuid.uuid4().hex}"},
        )
        assert r_pick.status_code == 200, r_pick.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        r1 = client.post(
            f"/api/v1/orders/{order.id}/reassign-picker",
            json={"assigned_to_user_id": str(picker2.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r1.status_code == 409
    assert "picking has started" in (r1.json().get("detail") or "").lower()
