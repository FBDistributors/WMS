"""To'rt ko'z qoidasi: o'zi yig'gan hujjatni o'zi tekshira olmaydi.

Profillar users.person_code bilan bog'lanadi. Kod bo'sh — eski xatti-harakat.
Yagona istisno: admin reassign-controller da allow_self_check=true (audit bilan).
"""
from __future__ import annotations

import uuid
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.services.person_identity import linked_user_ids, same_person
from tests.test_controller_pool_claim import _seed_sent_document
from tests.test_order_transition_policy import _mk_user


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: user


def _clear():
    app.dependency_overrides.pop(get_current_user, None)


def _controller(db: Session, person_code: str | None = None):
    ctrl = _mk_user(
        db, username=f"ctrl-4koz-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )
    if person_code is not None:
        ctrl.person_code = person_code
        db.commit()
        db.refresh(ctrl)
    return ctrl


def _link(db: Session, user, person_code: str):
    user.person_code = person_code
    db.commit()
    db.refresh(user)


# --- same_person servisi ---


def test_same_person_by_id_and_code(db_session: Session):
    a = _mk_user(db_session, username=f"a-{uuid.uuid4().hex[:8]}", role="picker")
    b = _mk_user(db_session, username=f"b-{uuid.uuid4().hex[:8]}", role="inventory_controller")

    assert same_person(db_session, a.id, a.id) is True
    assert same_person(db_session, a.id, b.id) is False  # kodlar bo'sh

    _link(db_session, a, "X-012")
    _link(db_session, b, "  x-012 ")  # probel/registr farqi bilan ham bitta shaxs
    assert same_person(db_session, a.id, b.id) is True

    _link(db_session, b, "X-013")
    assert same_person(db_session, a.id, b.id) is False


def test_linked_user_ids(db_session: Session):
    a = _mk_user(db_session, username=f"a-{uuid.uuid4().hex[:8]}", role="picker")
    b = _mk_user(db_session, username=f"b-{uuid.uuid4().hex[:8]}", role="inventory_controller")
    c = _mk_user(db_session, username=f"c-{uuid.uuid4().hex[:8]}", role="inventory_controller")
    _link(db_session, a, "X-777")
    _link(db_session, b, "X-777")

    ids = linked_user_ids(db_session, a.id, a.person_code)
    assert ids == {a.id, b.id}
    # Kod bo'sh — faqat o'zi.
    assert linked_user_ids(db_session, c.id, c.person_code) == {c.id}


# --- claim taqiqlari ---


def test_linked_controller_cannot_claim_own_pick(client: TestClient, db_session: Session):
    doc_id, picker = _seed_sent_document(client, db_session)
    ctrl = _controller(db_session, person_code="X-100")
    _link(db_session, picker, "X-100")  # picker va controller — bitta odam

    _as(ctrl)
    try:
        denied = client.post(f"/api/v1/picking/documents/{doc_id}/claim")
        assert denied.status_code == 409, denied.text
        assert denied.json()["detail"]["code"] == "self_check_forbidden"
    finally:
        _clear()

    db_session.expire_all()
    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.controlled_by_user_id is None  # navbatda qoladi


def test_unlinked_controller_claims_fine(client: TestClient, db_session: Session):
    doc_id, picker = _seed_sent_document(client, db_session)
    _link(db_session, picker, "X-200")
    ctrl = _controller(db_session, person_code="X-201")  # boshqa odam

    _as(ctrl)
    try:
        ok = client.post(f"/api/v1/picking/documents/{doc_id}/claim")
        assert ok.status_code == 200, ok.text
    finally:
        _clear()


def test_empty_person_codes_keep_old_behavior(client: TestClient, db_session: Session):
    """Regressiya: kodlar bo'sh — hech qanday blok yo'q (xavfsiz rollout)."""
    doc_id, _picker = _seed_sent_document(client, db_session)
    ctrl = _controller(db_session, person_code=None)

    _as(ctrl)
    try:
        ok = client.post(f"/api/v1/picking/documents/{doc_id}/claim")
        assert ok.status_code == 200, ok.text
    finally:
        _clear()


def test_queue_marks_own_pick(client: TestClient, db_session: Session):
    doc_id, picker = _seed_sent_document(client, db_session)
    ctrl = _controller(db_session, person_code="X-300")
    _link(db_session, picker, "X-300")

    _as(ctrl)
    try:
        listed = client.get("/api/v1/picking/documents")
        assert listed.status_code == 200, listed.text
        item = next(i for i in listed.json() if i["id"] == str(doc_id))
        assert item["is_own_pick"] is True
    finally:
        _clear()

    other = _controller(db_session, person_code="X-301")
    _as(other)
    try:
        listed = client.get("/api/v1/picking/documents")
        item = next(i for i in listed.json() if i["id"] == str(doc_id))
        assert item["is_own_pick"] is False
    finally:
        _clear()


# --- admin reassign: taqiq va override ---


def _order_id_for_doc(db: Session, doc_id: UUID) -> UUID:
    doc = db.query(Document).filter(Document.id == doc_id).one()
    assert doc.order_id is not None
    return doc.order_id


def test_admin_reassign_blocked_without_override(client: TestClient, db_session: Session):
    doc_id, picker = _seed_sent_document(client, db_session)
    ctrl = _controller(db_session, person_code="X-400")
    _link(db_session, picker, "X-400")
    admin = _mk_user(db_session, username=f"adm-4koz-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order_id = _order_id_for_doc(db_session, doc_id)

    _as(admin)
    try:
        denied = client.post(
            f"/api/v1/orders/{order_id}/reassign-controller",
            json={"controller_user_id": str(ctrl.id)},
        )
        assert denied.status_code == 409, denied.text
        assert denied.json()["detail"]["code"] == "self_check_forbidden"
    finally:
        _clear()


def test_admin_reassign_override_allowed_and_audited(client: TestClient, db_session: Session):
    doc_id, picker = _seed_sent_document(client, db_session)
    ctrl = _controller(db_session, person_code="X-500")
    _link(db_session, picker, "X-500")
    admin = _mk_user(db_session, username=f"adm-4koz-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    order_id = _order_id_for_doc(db_session, doc_id)

    _as(admin)
    try:
        ok = client.post(
            f"/api/v1/orders/{order_id}/reassign-controller",
            json={"controller_user_id": str(ctrl.id), "allow_self_check": True},
        )
        assert ok.status_code == 200, ok.text
    finally:
        _clear()

    db_session.expire_all()
    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.controlled_by_user_id == ctrl.id

    audits = (
        db_session.query(AuditLog)
        .filter(AuditLog.entity_type == "order", AuditLog.entity_id == str(order_id))
        .all()
    )
    reassign_rows = [
        a for a in audits if (a.new_data or {}).get("action") == "reassign_controller"
    ]
    assert reassign_rows, "reassign_controller audit yozuvi topilmadi"
    assert reassign_rows[-1].new_data.get("self_check_admin_override") is True
