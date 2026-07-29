"""Arxivdan qaytim: adminning tanlagan yig'uvchisiga tushishi.

Tanlanmasa — hujjatga biriktirilgan yig'uvchi (eski xatti-harakat).
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.safe_cancel_return import SafeCancelReturnSession
from tests.test_archive_revert_return import _complete_order_via_controller
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def _cancel_with_return_picker(
    client: TestClient, order_id, picker_id: str | None
) -> None:
    body: dict[str, object] = {"status": "cancelled"}
    if picker_id is not None:
        body["return_picker_user_id"] = picker_id
    res = client.patch(f"/api/v1/orders/{order_id}/status", json=body)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "cancelling_in_progress"


def test_selected_picker_gets_the_return(client: TestClient, db_session: Session) -> None:
    order, picker = _seed_allocatable_order(db_session)
    _complete_order_via_controller(client, db_session, order, picker)
    other = _mk_user(db_session, username=f"picker-ret-{uuid.uuid4().hex[:8]}", role="picker")
    admin = _mk_user(db_session, username=f"adm-rp-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        _cancel_with_return_picker(client, order.id, str(other.id))
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    session = (
        db_session.query(SafeCancelReturnSession)
        .filter(SafeCancelReturnSession.order_id == order.id)
        .one()
    )
    assert session.picker_user_id == other.id

    # Tanlangan yig'uvchi sessiyani ko'radi, hujjat yig'uvchisi ko'rmaydi.
    app.dependency_overrides[get_current_user] = lambda: other
    try:
        mine = client.get("/api/v1/picking/return-session/mine")
        assert mine.status_code == 200 and mine.json() is not None, mine.text
        assert mine.json()["id"] == str(session.id)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        mine = client.get("/api/v1/picking/return-session/mine")
        assert mine.status_code == 200
        assert mine.json() is None
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_without_selection_falls_back_to_document_picker(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    _complete_order_via_controller(client, db_session, order, picker)
    admin = _mk_user(db_session, username=f"adm-fb-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        _cancel_with_return_picker(client, order.id, None)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    session = (
        db_session.query(SafeCancelReturnSession)
        .filter(SafeCancelReturnSession.order_id == order.id)
        .one()
    )
    assert session.picker_user_id == picker.id


def test_non_picker_selection_is_rejected(client: TestClient, db_session: Session) -> None:
    order, picker = _seed_allocatable_order(db_session)
    _complete_order_via_controller(client, db_session, order, picker)
    controller = _mk_user(
        db_session, username=f"ctl-rp-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )
    admin = _mk_user(db_session, username=f"adm-rej-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.patch(
            f"/api/v1/orders/{order.id}/status",
            json={"status": "cancelled", "return_picker_user_id": str(controller.id)},
        )
        assert res.status_code == 400, res.text

        missing = client.patch(
            f"/api/v1/orders/{order.id}/status",
            json={"status": "cancelled", "return_picker_user_id": str(uuid.uuid4())},
        )
        assert missing.status_code == 400, missing.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    # Rad etilgach buyurtma o'z holicha qoladi — qaytim sessiyasi ochilmaydi.
    db_session.expire_all()
    assert (
        db_session.query(SafeCancelReturnSession)
        .filter(SafeCancelReturnSession.order_id == order.id)
        .count()
        == 0
    )
