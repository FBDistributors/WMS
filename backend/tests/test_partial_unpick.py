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


def _lot_loc_from_order_allocations(db_session: Session, order_id: UUID) -> tuple[UUID, UUID]:
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
    raise AssertionError("no allocate movement found")


def _send_order_to_picking(client: TestClient, db_session: Session, order_id: UUID, picker_id: UUID) -> UUID:
    admin = _mk_user(
        db_session, username=f"adm-unpick-{uuid.uuid4().hex[:8]}", role="warehouse_admin"
    )
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        send = client.post(
            f"/api/v1/orders/{order_id}/send-to-picking",
            json={"assigned_to_user_id": str(picker_id)},
        )
        assert send.status_code == 200, send.text
        return UUID(send.json()["pick_task_id"])
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_picker_partial_unpick_restores_reserve_and_keeps_reason(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _send_order_to_picking(client, db_session, order.id, picker.id)
    lot_id, loc_id = _lot_loc_from_order_allocations(db_session, order.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
        assert doc.status_code == 200, doc.text
        line = doc.json()["lines"][0]
        line_id = UUID(line["id"])
        required_qty = max(1, int(float(line["qty_required"])))
        pick_delta = min(5, required_qty)
        rollback_delta = 1 if pick_delta > 1 else pick_delta

        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={"delta": pick_delta, "request_id": f"pick-{uuid.uuid4().hex}"},
        )
        assert pick.status_code == 200, pick.text

        _on_hand_after_pick, reserved_after_pick, _available_after_pick = compute_lot_location_balances(
            db_session, lot_id, loc_id
        )

        unpick = client.post(
            f"/api/v1/picking/lines/{line_id}/unpick",
            json={
                "delta": rollback_delta,
                "reason": "wrong_location",
                "request_id": f"unpick-{uuid.uuid4().hex}",
            },
        )
        assert unpick.status_code == 200, unpick.text
        body = unpick.json()
        assert Decimal(str(body["line"]["qty_picked"])) == Decimal(str(pick_delta - rollback_delta))
        assert body["line"]["skip_reason"] == "wrong_location"
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    _on_hand_after_unpick, reserved_after_unpick, _available_after_unpick = compute_lot_location_balances(
        db_session, lot_id, loc_id
    )
    assert Decimal(str(reserved_after_unpick)) == Decimal(str(reserved_after_pick)) + Decimal(
        str(rollback_delta)
    )


def test_controller_can_unpick_only_own_controlled_document(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _send_order_to_picking(client, db_session, order.id, picker.id)
    controller = _mk_user(
        db_session, username=f"ctrl-unpick-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )
    other_controller = _mk_user(
        db_session, username=f"ctrl-other-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
        line_id = UUID(doc.json()["lines"][0]["id"])
        required_qty = max(1, int(float(doc.json()["lines"][0]["qty_required"])))
        pick_delta = min(4, required_qty)
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={"delta": pick_delta, "request_id": f"pick-{uuid.uuid4().hex}"},
        )
        assert pick.status_code == 200, pick.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    pick_doc = db_session.query(Document).filter(Document.id == doc_id).one()
    pick_doc.controlled_by_user_id = controller.id
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: other_controller
    try:
        denied = client.post(
            f"/api/v1/picking/lines/{line_id}/unpick",
            json={
                "delta": 1,
                "reason": "other",
                "request_id": f"unpick-denied-{uuid.uuid4().hex}",
            },
        )
        assert denied.status_code == 403, denied.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: controller
    try:
        ok = client.post(
            f"/api/v1/picking/lines/{line_id}/unpick",
            json={
                "delta": 1,
                "reason": "other",
                "request_id": f"unpick-ok-{uuid.uuid4().hex}",
            },
        )
        assert ok.status_code == 200, ok.text
        assert Decimal(str(ok.json()["line"]["qty_picked"])) == Decimal(str(pick_delta - 1))
    finally:
        app.dependency_overrides.pop(get_current_user, None)
