"""Controller pool oqimi: yig'uvchi controller tanlamaydi, hujjat umumiy navbatga tushadi.

Navbatdagi hujjatni har qanday controller ko'radi; birinchi band qilgan (claim) unga
egalik qiladi, boshqasi 409 oladi.
"""
from __future__ import annotations

import uuid
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.document import Document
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def _controller(db_session: Session, tag: str):
    return _mk_user(
        db_session, username=f"ctrl-{tag}-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: user


def _clear():
    app.dependency_overrides.pop(get_current_user, None)


def _seed_sent_document(client: TestClient, db_session: Session) -> tuple[UUID, object]:
    """Buyurtma yaratib, yig'uvchi terib, tekshiruv navbatiga yuboradi."""
    order, picker = _seed_allocatable_order(db_session)
    admin = _mk_user(
        db_session, username=f"adm-pool-{uuid.uuid4().hex[:8]}", role="warehouse_admin"
    )

    _as(admin)
    try:
        send = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        assert send.status_code == 200, send.text
        doc_id = UUID(send.json()["pick_task_id"])
    finally:
        _clear()

    _as(picker)
    try:
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
        assert doc.status_code == 200, doc.text
        line = doc.json()["lines"][0]
        pick = client.post(
            f"/api/v1/picking/lines/{UUID(line['id'])}/pick",
            json={
                "delta": max(1, int(float(line["qty_required"]))),
                "request_id": f"pick-pool-{uuid.uuid4().hex}",
            },
        )
        assert pick.status_code == 200, pick.text
        complete = client.post(f"/api/v1/picking/documents/{doc_id}/complete")
        assert complete.status_code == 200, complete.text
        sent = client.post(f"/api/v1/picking/documents/{doc_id}/send-to-controller")
        assert sent.status_code == 200, sent.text
    finally:
        _clear()

    return doc_id, picker


def _doc_ids(client: TestClient) -> list[str]:
    resp = client.get("/api/v1/picking/documents")
    assert resp.status_code == 200, resp.text
    return [item["id"] for item in resp.json()]


def test_send_to_controller_puts_document_in_pool(
    client: TestClient, db_session: Session
) -> None:
    doc_id, picker = _seed_sent_document(client, db_session)

    db_session.expire_all()
    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.sent_to_controller_at is not None
    assert doc.controlled_by_user_id is None

    # Yuborilgan hujjat yig'uvchi ro'yxatida ham, umumiy yig'ishda ham ko'rinmaydi.
    _as(picker)
    try:
        assert str(doc_id) not in _doc_ids(client)
        consolidated = client.get("/api/v1/picking/consolidated")
        assert consolidated.status_code == 200, consolidated.text
        assert str(doc_id) not in [d["id"] for d in consolidated.json()["documents"]]
    finally:
        _clear()


def test_send_to_controller_twice_conflicts(client: TestClient, db_session: Session) -> None:
    doc_id, picker = _seed_sent_document(client, db_session)

    _as(picker)
    try:
        again = client.post(f"/api/v1/picking/documents/{doc_id}/send-to-controller")
    finally:
        _clear()
    assert again.status_code == 409


def test_pool_document_is_visible_to_every_controller(
    client: TestClient, db_session: Session
) -> None:
    doc_id, _ = _seed_sent_document(client, db_session)
    ctrl1 = _controller(db_session, "vis1")
    ctrl2 = _controller(db_session, "vis2")

    for ctrl in (ctrl1, ctrl2):
        _as(ctrl)
        try:
            assert str(doc_id) in _doc_ids(client)
            opened = client.get(f"/api/v1/picking/documents/{doc_id}")
            assert opened.status_code == 200, opened.text
        finally:
            _clear()

    # Ko'rish claim qilmaydi — hujjat navbatda qoladi.
    db_session.expire_all()
    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.controlled_by_user_id is None


def test_claim_is_exclusive(client: TestClient, db_session: Session) -> None:
    doc_id, _ = _seed_sent_document(client, db_session)
    ctrl1 = _controller(db_session, "clm1")
    ctrl2 = _controller(db_session, "clm2")

    _as(ctrl1)
    try:
        claimed = client.post(f"/api/v1/picking/documents/{doc_id}/claim")
        assert claimed.status_code == 200, claimed.text
        # Takroriy claim (o'zi) — muvaffaqiyatli.
        again = client.post(f"/api/v1/picking/documents/{doc_id}/claim")
        assert again.status_code == 200, again.text
    finally:
        _clear()

    db_session.expire_all()
    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.controlled_by_user_id == ctrl1.id
    assert doc.controller_claimed_at is not None
    assert doc.controller_verification_started_at is None

    _as(ctrl2)
    try:
        denied = client.post(f"/api/v1/picking/documents/{doc_id}/claim")
        assert denied.status_code == 409, denied.text
        assert denied.json()["detail"]["code"] == "controller_already_claimed"
        # Band qilingan hujjat boshqa controller ro'yxatidan yo'qoladi.
        assert str(doc_id) not in _doc_ids(client)
        assert client.get(f"/api/v1/picking/documents/{doc_id}").status_code == 404
    finally:
        _clear()


def test_verification_started_claims_implicitly(
    client: TestClient, db_session: Session
) -> None:
    """Eski ilova claim endpointini bilmaydi — birinchi skanda band qilinadi."""
    doc_id, _ = _seed_sent_document(client, db_session)
    ctrl1 = _controller(db_session, "impl1")
    ctrl2 = _controller(db_session, "impl2")

    _as(ctrl1)
    try:
        started = client.post(
            f"/api/v1/picking/documents/{doc_id}/controller-verification-started"
        )
        assert started.status_code == 200, started.text
    finally:
        _clear()

    db_session.expire_all()
    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.controlled_by_user_id == ctrl1.id
    assert doc.controller_verification_started_at is not None

    _as(ctrl2)
    try:
        denied = client.post(
            f"/api/v1/picking/documents/{doc_id}/controller-verification-started"
        )
        assert denied.status_code == 409, denied.text
    finally:
        _clear()


def test_release_puts_document_back_in_pool(client: TestClient, db_session: Session) -> None:
    doc_id, _ = _seed_sent_document(client, db_session)
    ctrl1 = _controller(db_session, "rel1")
    ctrl2 = _controller(db_session, "rel2")

    _as(ctrl1)
    try:
        assert client.post(f"/api/v1/picking/documents/{doc_id}/claim").status_code == 200
        released = client.post(f"/api/v1/picking/documents/{doc_id}/release")
        assert released.status_code == 200, released.text
    finally:
        _clear()

    db_session.expire_all()
    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.controlled_by_user_id is None
    assert doc.controller_claimed_at is None

    _as(ctrl2)
    try:
        assert str(doc_id) in _doc_ids(client)
        assert client.post(f"/api/v1/picking/documents/{doc_id}/claim").status_code == 200
    finally:
        _clear()


def test_release_rejected_after_verification_started(
    client: TestClient, db_session: Session
) -> None:
    doc_id, _ = _seed_sent_document(client, db_session)
    ctrl = _controller(db_session, "relv")

    _as(ctrl)
    try:
        assert (
            client.post(
                f"/api/v1/picking/documents/{doc_id}/controller-verification-started"
            ).status_code
            == 200
        )
        denied = client.post(f"/api/v1/picking/documents/{doc_id}/release")
    finally:
        _clear()
    assert denied.status_code == 409


def test_complete_from_pool_attributes_to_completing_controller(
    client: TestClient, db_session: Session
) -> None:
    doc_id, _ = _seed_sent_document(client, db_session)
    ctrl = _controller(db_session, "cmp")

    _as(ctrl)
    try:
        done = client.post(f"/api/v1/picking/documents/{doc_id}/complete")
        assert done.status_code == 200, done.text
    finally:
        _clear()

    db_session.expire_all()
    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.status == "completed"
    assert doc.controlled_by_user_id == ctrl.id


def test_admin_release_returns_claimed_document_to_pool(
    client: TestClient, db_session: Session
) -> None:
    doc_id, _ = _seed_sent_document(client, db_session)
    ctrl = _controller(db_session, "admrel")
    admin = _mk_user(
        db_session, username=f"adm-rel-{uuid.uuid4().hex[:8]}", role="warehouse_admin"
    )

    _as(ctrl)
    try:
        assert client.post(f"/api/v1/picking/documents/{doc_id}/claim").status_code == 200
    finally:
        _clear()

    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    order_id = doc.order_id

    _as(admin)
    try:
        released = client.post(f"/api/v1/orders/{order_id}/release-controller")
        assert released.status_code == 200, released.text
        assert released.json()["released_from"] == str(ctrl.id)
    finally:
        _clear()

    db_session.expire_all()
    db_session.refresh(doc)
    assert doc.controlled_by_user_id is None
