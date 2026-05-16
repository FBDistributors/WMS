from __future__ import annotations

from decimal import Decimal
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.location import Location
from app.models.order import Order, OrderLine, OrderWmsState
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.services.order_transition_policy import get_transition_rule


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


def _seed_allocatable_order(db: Session) -> tuple[Order, User]:
    picker = _mk_user(db, username=f"picker-{uuid.uuid4().hex[:8]}", role="picker")
    product = Product(
        external_source="test",
        external_id=f"prod-{uuid.uuid4().hex[:8]}",
        name="Policy Product",
        sku=f"SKU-POL-{uuid.uuid4().hex[:8]}",
        is_active=True,
    )
    db.add(product)
    db.flush()

    loc = Location(
        code=f"POL-{uuid.uuid4().hex[:8]}",
        barcode_value=f"POL-{uuid.uuid4().hex[:8]}",
        name="Policy bin",
        type="bin",
        is_active=True,
    )
    db.add(loc)
    db.flush()

    lot = StockLot(product_id=product.id, batch="POL-BATCH", expiry_date=None)
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
        source_external_id=f"order-ext-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-POL-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = [
        OrderLine(
            sku=product.sku,
            name="Policy line",
            qty=2.0,
            uom="dona",
        )
    ]
    db.add(order)
    db.commit()
    db.refresh(order)
    return order, picker


def test_policy_allows_core_transitions() -> None:
    assert get_transition_rule("imported", "allocated") is not None
    assert get_transition_rule("W", "allocated") is not None
    assert get_transition_rule("picking", "cancelling_in_progress") is not None
    assert get_transition_rule("cancelling_in_progress", "cancelled") is not None


def test_policy_blocks_non_core_transition() -> None:
    assert get_transition_rule("imported", "picked") is None


def test_update_status_hard_blocks_invalid_transition(client: TestClient, db_session: Session) -> None:
    admin = _mk_user(db_session, username=f"admin-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order = Order(
        source="test",
        source_external_id=f"order-status-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-STATUS-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.patch(f"/api/v1/orders/{order.id}/status", json={"status": "packed"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert res.status_code == 409
    assert "Core-flow transition blocked" in (res.json().get("detail") or "")


def test_send_to_picking_idempotency_prevents_duplicate_allocate(client: TestClient, db_session: Session) -> None:
    admin = _mk_user(db_session, username=f"admin2-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order, picker = _seed_allocatable_order(db_session)

    body = {"assigned_to_user_id": str(picker.id)}
    headers = {"Idempotency-Key": "order-send-dedup-1"}
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        r1 = client.post(f"/api/v1/orders/{order.id}/send-to-picking", json=body, headers=headers)
        r2 = client.post(f"/api/v1/orders/{order.id}/send-to-picking", json=body, headers=headers)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["pick_task_id"] == r2.json()["pick_task_id"]

    allocate_rows = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.movement_type == "allocate",
            StockMovement.source_document_type == "order",
            StockMovement.source_document_id == order.id,
        )
        .count()
    )
    assert allocate_rows == 1

