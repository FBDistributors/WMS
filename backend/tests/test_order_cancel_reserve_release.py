from __future__ import annotations

from decimal import Decimal
from uuid import UUID
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.order import Order, OrderWmsState
from app.models.stock import StockMovement
from app.services.stock_availability import compute_lot_location_balances
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def test_direct_cancel_releases_allocate(
    client: TestClient, db_session: Session
) -> None:
    admin = _mk_user(db_session, username=f"admin-cancel-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order, picker = _seed_allocatable_order(db_session)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        send = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        assert send.status_code == 200
        doc_id = send.json()["pick_task_id"]

        allocate_count = (
            db_session.query(StockMovement)
            .filter(
                StockMovement.movement_type == "allocate",
                StockMovement.source_document_type == "order",
                StockMovement.source_document_id == order.id,
            )
            .count()
        )
        assert allocate_count >= 1

        cancel = client.patch(f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"})
        assert cancel.status_code == 200
        assert cancel.json()["status"] == "cancelled"
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    unallocate_count = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.movement_type == "unallocate",
            StockMovement.source_document_type == "document",
            StockMovement.source_document_id == UUID(doc_id),
        )
        .count()
    )
    assert unallocate_count >= 1

    db_session.refresh(order)
    lot_id = None
    loc_id = None
    for mv in (
        db_session.query(StockMovement)
        .filter(
            StockMovement.movement_type == "allocate",
            StockMovement.source_document_type == "order",
            StockMovement.source_document_id == order.id,
        )
        .all()
    ):
        lot_id = mv.lot_id
        loc_id = mv.location_id
        break
    assert lot_id is not None and loc_id is not None
    _on_hand, reserved, available = compute_lot_location_balances(db_session, lot_id, loc_id)
    assert reserved == 0
    assert available == Decimal("10")


def test_direct_cancel_idempotent_reserve(
    client: TestClient, db_session: Session
) -> None:
    admin = _mk_user(db_session, username=f"admin-cancel2-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order, picker = _seed_allocatable_order(db_session)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        send = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        doc_id = send.json()["pick_task_id"]
        client.patch(f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"})
        again = client.patch(f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert again.status_code == 409

    unallocate_rows = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.movement_type == "unallocate",
            StockMovement.source_document_type == "document",
            StockMovement.source_document_id == UUID(doc_id),
        )
        .count()
    )
    assert unallocate_rows == 1


def test_cancel_without_document_blocks_transition(
    client: TestClient, db_session: Session
) -> None:
    admin = _mk_user(db_session, username=f"admin-cancel3-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order = Order(
        source="test",
        source_external_id=f"order-nodoc-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-NODOC-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.patch(f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert res.status_code == 409
    assert "Core-flow transition blocked" in (res.json().get("detail") or "")

    movement_count = (
        db_session.query(StockMovement)
        .filter(StockMovement.movement_type.in_(("allocate", "unallocate")))
        .count()
    )
    assert movement_count == 0
