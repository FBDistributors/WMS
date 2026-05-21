from __future__ import annotations

import uuid
from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.document import Document
from app.services.stock_availability import compute_lot_location_balances
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def _lot_loc_from_send(db_session: Session, order_id: UUID) -> tuple[UUID, UUID]:
    from app.models.stock import StockMovement

    for mv in (
        db_session.query(StockMovement)
        .filter(
            StockMovement.movement_type == "allocate",
            StockMovement.source_document_type == "order",
            StockMovement.source_document_id == order_id,
        )
        .all()
    ):
        return mv.lot_id, mv.location_id
    raise AssertionError("no allocate movement")


def _pick_skip_flow(
    client: TestClient,
    db_session: Session,
    *,
    order,
    picker,
) -> tuple[UUID, UUID, UUID]:
    """send-to-picking, pick full line, skip with reason. Returns order_id, doc_id, line_id."""
    admin = _mk_user(db_session, username=f"adm-skip-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        send = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        assert send.status_code == 200, send.text
        doc_id = UUID(send.json()["pick_task_id"])
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
        assert doc.status_code == 200, doc.text
        lines = doc.json()["lines"]
        assert len(lines) >= 1
        line_id = UUID(lines[0]["id"])
        required = int(lines[0]["qty_required"])
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={"delta": required, "request_id": f"pick-{uuid.uuid4().hex}"},
        )
        assert pick.status_code == 200, pick.text
        skip = client.post(
            f"/api/v1/picking/lines/{line_id}/skip",
            json={"reason": "out_of_stock"},
        )
        assert skip.status_code == 200, skip.text
        assert skip.json()["line"]["skip_reason"] == "out_of_stock"
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    return order.id, doc_id, line_id


def test_skip_line_then_cancel_releases_reserve(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    order_id, doc_id, _line_id = _pick_skip_flow(client, db_session, order=order, picker=picker)
    lot_id, loc_id = _lot_loc_from_send(db_session, order_id)

    admin = _mk_user(db_session, username=f"adm-skip-cancel-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        cancel = client.patch(f"/api/v1/orders/{order_id}/status", json={"status": "cancelled"})
        assert cancel.status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    _on_hand, reserved, _available = compute_lot_location_balances(db_session, lot_id, loc_id)
    assert reserved == 0


def test_skip_line_then_controller_complete_releases_reserve(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    order_id, doc_id, _line_id = _pick_skip_flow(client, db_session, order=order, picker=picker)
    lot_id, loc_id = _lot_loc_from_send(db_session, order_id)
    controller = _mk_user(
        db_session, username=f"ctrl-skip-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        complete_picker = client.post(
            f"/api/v1/picking/documents/{doc_id}/complete",
            json={"incomplete_reason": "out_of_stock"},
        )
        assert complete_picker.status_code == 200, complete_picker.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    doc.controlled_by_user_id = controller.id
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: controller
    try:
        complete_ctrl = client.post(f"/api/v1/picking/documents/{doc_id}/complete")
        assert complete_ctrl.status_code == 200, complete_ctrl.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    _on_hand, reserved, _available = compute_lot_location_balances(db_session, lot_id, loc_id)
    assert reserved == 0
