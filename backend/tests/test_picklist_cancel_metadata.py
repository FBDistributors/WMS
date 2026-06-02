"""Pick list metadata: assignment timestamps and cancel admin on list API."""
from __future__ import annotations

import uuid
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.document import Document
from app.models.order import OrderWmsState
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def test_send_to_picking_sets_first_assigned_at(
    client: TestClient, db_session: Session
) -> None:
    admin = _mk_user(db_session, username=f"adm-meta-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order, picker = _seed_allocatable_order(db_session)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        assert res.status_code == 200, res.text
        doc_id = UUID(res.json()["pick_task_id"])
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.first_assigned_at is not None
    assert doc.last_assigned_at is None


def test_reassign_picker_sets_last_assigned_at(
    client: TestClient, db_session: Session
) -> None:
    admin = _mk_user(db_session, username=f"adm-reas-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order, picker1 = _seed_allocatable_order(db_session)
    picker2 = _mk_user(db_session, username=f"picker2-{uuid.uuid4().hex[:8]}", role="picker")

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        send = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker1.id)},
        )
        assert send.status_code == 200
        doc_id = UUID(send.json()["pick_task_id"])
        first_at = db_session.query(Document).filter(Document.id == doc_id).one().first_assigned_at

        reassign = client.post(
            f"/api/v1/orders/{order.id}/reassign-picker",
            json={"assigned_to_user_id": str(picker2.id)},
        )
        assert reassign.status_code == 200, reassign.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.first_assigned_at == first_at
    assert doc.last_assigned_at is not None
    assert doc.assigned_to_user_id == picker2.id


def test_direct_cancel_sets_cancel_metadata_and_list_returns_it(
    client: TestClient, db_session: Session
) -> None:
    admin = _mk_user(db_session, username=f"adm-clist-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order, picker = _seed_allocatable_order(db_session)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        send = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        assert send.status_code == 200
        cancel = client.patch(f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"})
        assert cancel.status_code == 200

        listed = client.get("/api/v1/picking/documents", params={"process_scope": "cancelled", "limit": 50})
        assert listed.status_code == 200, listed.text
        row = next((x for x in listed.json() if x.get("order_id") == str(order.id)), None)
        assert row is not None
        assert row["first_assigned_at"] is not None
        assert row["cancelled_at"] is not None
        assert row["cancelled_by_user_name"] == (admin.full_name or admin.username)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    wms = db_session.query(OrderWmsState).filter(OrderWmsState.order_id == order.id).one()
    assert wms.cancelled_at is not None
    assert wms.cancelled_by_user_id == admin.id
