"""Arxiv (completed) buyurtmani qaytim bilan bekor qilish.

Oqim: pick -> picker complete -> send-to-controller -> controller complete
(completed) -> admin cancel -> qaytim sessiyasi -> skan -> finish -> cancelled,
qoldiq va rezerv to'liq tiklanadi.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.document import Document, DocumentLine
from app.services.stock_availability import compute_lot_location_balances
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order
from tests.test_safe_cancel_return_finish import _lot_loc_from_order_allocate


def _complete_order_via_controller(
    client: TestClient, db_session: Session, order, picker
) -> UUID:
    """Buyurtmani to'liq terib, controller orqali completed holatiga yetkazadi."""
    admin = _mk_user(db_session, username=f"adm-ar-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    controller = _mk_user(
        db_session, username=f"ctl-ar-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )

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
        line = doc.json()["lines"][0]
        pick = client.post(
            f"/api/v1/picking/lines/{line['id']}/pick",
            json={"delta": int(line["qty_required"]), "request_id": f"p-{uuid.uuid4().hex}"},
        )
        assert pick.status_code == 200, pick.text
        complete = client.post(f"/api/v1/picking/documents/{doc_id}/complete")
        assert complete.status_code == 200, complete.text
        to_ctrl = client.post(
            f"/api/v1/picking/documents/{doc_id}/send-to-controller",
            json={"controller_user_id": str(controller.id)},
        )
        assert to_ctrl.status_code == 200, to_ctrl.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: controller
    try:
        ctrl_complete = client.post(f"/api/v1/picking/documents/{doc_id}/complete")
        assert ctrl_complete.status_code == 200, ctrl_complete.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    db_session.refresh(order)
    assert order.wms_state.status == "completed"
    return doc_id


def test_archive_revert_returns_stock_and_cancels(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _complete_order_via_controller(client, db_session, order, picker)

    lot_id, loc_id = _lot_loc_from_order_allocate(db_session, order.id)
    on_hand_completed, reserved_completed, _ = compute_lot_location_balances(
        db_session, lot_id, loc_id
    )
    # Terilgan 2 dona chiqib ketgan (10 -> 8), rezerv 0.
    assert on_hand_completed == Decimal("8")
    assert reserved_completed == 0

    admin = _mk_user(db_session, username=f"adm-rv-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        cancel = client.patch(f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"})
        assert cancel.status_code == 200, cancel.text
        assert cancel.json()["status"] == "cancelling_in_progress"
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    # Yig'uvchi qaytim sessiyasini bajaradi.
    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        mine = client.get("/api/v1/picking/return-session/mine")
        assert mine.status_code == 200 and mine.json() is not None, mine.text
        session_id = UUID(mine.json()["id"])
        for sl in mine.json()["lines"]:
            r_loc = client.post(
                f"/api/v1/picking/return-session/{session_id}/scan-location",
                json={"raw": sl["expected_location_code"]},
            )
            assert r_loc.status_code == 200, r_loc.text
            r_prod = client.post(
                f"/api/v1/picking/return-session/{session_id}/scan-product",
                json={"raw": sl.get("barcode") or sl.get("sku") or ""},
            )
            assert r_prod.status_code == 200, r_prod.text
        finish = client.post(f"/api/v1/picking/return-session/{session_id}/finish")
        assert finish.status_code == 200, finish.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    db_session.refresh(order)
    assert order.wms_state.status == "cancelled"

    on_hand_after, reserved_after, available_after = compute_lot_location_balances(
        db_session, lot_id, loc_id
    )
    assert on_hand_after == Decimal("10")
    assert reserved_after == 0
    assert available_after == Decimal("10")

    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.status == "cancelled"
    lines = db_session.query(DocumentLine).filter(DocumentLine.document_id == doc_id).all()
    assert all(float(ln.picked_qty or 0) == 0 for ln in lines)


def test_archive_revert_rejected_after_ship(client: TestClient, db_session: Session) -> None:
    """Jo'natilgan (ship harakati yozilgan) buyurtma qaytimga rad etiladi."""
    from app.models.stock import StockMovement

    order, picker = _seed_allocatable_order(db_session)
    doc_id = _complete_order_via_controller(client, db_session, order, picker)
    lot_id, loc_id = _lot_loc_from_order_allocate(db_session, order.id)

    line = db_session.query(DocumentLine).filter(DocumentLine.document_id == doc_id).first()
    db_session.add(
        StockMovement(
            product_id=line.product_id,
            lot_id=lot_id,
            location_id=loc_id,
            qty_change=Decimal("-1"),
            movement_type="ship",
            source_document_type="order",
            source_document_id=order.id,
        )
    )
    db_session.commit()

    admin = _mk_user(db_session, username=f"adm-sh-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        cancel = client.patch(f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"})
        assert cancel.status_code == 409, cancel.text
        assert "ship" in cancel.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    db_session.refresh(order)
    assert order.wms_state.status == "completed"
