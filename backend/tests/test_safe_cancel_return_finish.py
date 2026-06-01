"""Xavfsiz bekor: terilgan buyurtmani joyiga qaytarib yakunlash (finish return)."""
from __future__ import annotations

import uuid
from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.document import DocumentLine
from app.services.stock_availability import compute_lot_location_balances
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def _lot_loc_from_order_allocate(db_session: Session, order_id: UUID) -> tuple[UUID, UUID]:
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


def test_safe_cancel_finish_return_after_pick(
    client: TestClient, db_session: Session
) -> None:
    """Pick → admin cancel (cancelling_in_progress) → scan → finish → cancelled, reserved=0."""
    order, picker = _seed_allocatable_order(db_session)
    admin = _mk_user(db_session, username=f"adm-scr-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

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
        loc_code = lines[0].get("location_code") or ""
        scan_code = lines[0].get("barcode") or lines[0].get("sku") or ""
        assert loc_code and scan_code

        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={"delta": required, "request_id": f"pick-{uuid.uuid4().hex}"},
        )
        assert pick.status_code == 200, pick.text

        db_session.refresh(order)
        assert order.wms_state.status == "picking"
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    lot_id, loc_id = _lot_loc_from_order_allocate(db_session, order.id)
    on_hand_initial, reserved_after_pick, _ = compute_lot_location_balances(
        db_session, lot_id, loc_id
    )
    assert on_hand_initial == Decimal("8")
    assert reserved_after_pick == 0

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        cancel = client.patch(f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"})
        assert cancel.status_code == 200, cancel.text
        assert cancel.json()["status"] == "cancelling_in_progress"
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        mine = client.get("/api/v1/picking/return-session/mine")
        assert mine.status_code == 200, mine.text
        assert mine.json() is not None
        session_id = UUID(mine.json()["id"])
        session_lines = mine.json()["lines"]
        assert len(session_lines) >= 1

        for sl in session_lines:
            loc = sl["expected_location_code"]
            scan = sl.get("barcode") or sl.get("sku") or ""
            assert loc and scan
            r_loc = client.post(
                f"/api/v1/picking/return-session/{session_id}/scan-location",
                json={"raw": loc},
            )
            assert r_loc.status_code == 200, r_loc.text
            r_prod = client.post(
                f"/api/v1/picking/return-session/{session_id}/scan-product",
                json={"raw": scan},
            )
            assert r_prod.status_code == 200, r_prod.text

        finish = client.post(f"/api/v1/picking/return-session/{session_id}/finish")
        assert finish.status_code == 200, finish.text
        assert finish.json()["status"] == "completed"
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    db_session.refresh(order)
    assert order.wms_state.status == "cancelled"

    on_hand_after_finish, reserved_final, available_final = compute_lot_location_balances(
        db_session, lot_id, loc_id
    )
    assert reserved_final == 0
    assert on_hand_after_finish == Decimal("10")
    assert available_final == Decimal("10")

    picked_lines = (
        db_session.query(DocumentLine)
        .filter(DocumentLine.document_id == doc_id)
        .all()
    )
    assert all(float(ln.picked_qty or 0) == 0 for ln in picked_lines)
