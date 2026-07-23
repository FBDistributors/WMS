from __future__ import annotations

import uuid
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.document import Document
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def _admin_override(db_session: Session):
    admin = _mk_user(
        db_session, username=f"adm-rc-{uuid.uuid4().hex[:8]}", role="warehouse_admin"
    )
    app.dependency_overrides[get_current_user] = lambda: admin
    return admin


def _pick_and_send_to_controller(
    client: TestClient,
    db_session: Session,
    *,
    doc_id: UUID,
    picker,
) -> None:
    """Yig'uvchi terib, hujjatni umumiy tekshiruv navbatiga yuboradi (controller tanlanmaydi)."""
    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
        assert doc.status_code == 200, doc.text
        line = doc.json()["lines"][0]
        line_id = UUID(line["id"])
        required_qty = max(1, int(float(line["qty_required"])))
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={"delta": required_qty, "request_id": f"pick-rc-{uuid.uuid4().hex}"},
        )
        assert pick.status_code == 200, pick.text
        complete = client.post(f"/api/v1/picking/documents/{doc_id}/complete")
        assert complete.status_code == 200, complete.text
        send = client.post(f"/api/v1/picking/documents/{doc_id}/send-to-controller")
        assert send.status_code == 200, send.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_reassign_controller_success(client: TestClient, db_session: Session) -> None:
    order, picker = _seed_allocatable_order(db_session)
    controller1 = _mk_user(
        db_session, username=f"ctrl1-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )
    controller2 = _mk_user(
        db_session, username=f"ctrl2-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )

    admin = _admin_override(db_session)
    try:
        send = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        assert send.status_code == 200, send.text
        doc_id = UUID(send.json()["pick_task_id"])
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    _pick_and_send_to_controller(
        client, db_session, doc_id=doc_id, picker=picker
    )

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        resp = client.post(
            f"/api/v1/orders/{order.id}/reassign-controller",
            json={"controller_user_id": str(controller2.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["document_id"] == str(doc_id)
    assert body["controlled_by"] == str(controller2.id)

    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.controlled_by_user_id == controller2.id
    assert doc.controller_verification_started_at is None


def test_reassign_controller_allowed_after_open_before_scan(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    controller1 = _mk_user(
        db_session, username=f"ctrl-open-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )
    controller2 = _mk_user(
        db_session, username=f"ctrl-open2-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )

    admin = _admin_override(db_session)
    try:
        send = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        doc_id = UUID(send.json()["pick_task_id"])
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    _pick_and_send_to_controller(
        client, db_session, doc_id=doc_id, picker=picker
    )

    app.dependency_overrides[get_current_user] = lambda: controller1
    try:
        opened = client.get(f"/api/v1/picking/documents/{doc_id}")
        assert opened.status_code == 200, opened.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.controller_verification_started_at is None

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        resp = client.post(
            f"/api/v1/orders/{order.id}/reassign-controller",
            json={"controller_user_id": str(controller2.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200, resp.text
    db_session.refresh(doc)
    assert doc.controlled_by_user_id == controller2.id


def test_reassign_controller_rejects_after_verification_started(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    controller1 = _mk_user(
        db_session, username=f"ctrl-scan-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )
    controller2 = _mk_user(
        db_session, username=f"ctrl-scan2-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )

    admin = _admin_override(db_session)
    try:
        send = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        doc_id = UUID(send.json()["pick_task_id"])
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    _pick_and_send_to_controller(
        client, db_session, doc_id=doc_id, picker=picker
    )

    app.dependency_overrides[get_current_user] = lambda: controller1
    try:
        started = client.post(
            f"/api/v1/picking/documents/{doc_id}/controller-verification-started"
        )
        assert started.status_code == 200, started.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.controller_verification_started_at is not None

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        denied = client.post(
            f"/api/v1/orders/{order.id}/reassign-controller",
            json={"controller_user_id": str(controller2.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert denied.status_code == 409
    assert "verification" in (denied.json().get("detail") or "").lower()


def test_reassign_controller_rejects_invalid_user(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    controller = _mk_user(
        db_session, username=f"ctrl-inv-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )

    admin = _admin_override(db_session)
    try:
        send = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        doc_id = UUID(send.json()["pick_task_id"])
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    _pick_and_send_to_controller(
        client, db_session, doc_id=doc_id, picker=picker
    )

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        denied = client.post(
            f"/api/v1/orders/{order.id}/reassign-controller",
            json={"controller_user_id": str(picker.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert denied.status_code == 400
    assert "Invalid controller" in (denied.json().get("detail") or "")
