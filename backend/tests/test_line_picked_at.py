"""document_lines.picked_at: skan + miqdor tasdig'i vaqti yoziladi, qaytarilsa o'chadi."""
from __future__ import annotations

import uuid
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.document import Document, DocumentLine
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def _send_order_to_picking(
    client: TestClient, db_session: Session, order_id: UUID, picker_id: UUID
) -> UUID:
    admin = _mk_user(
        db_session, username=f"adm-pat-{uuid.uuid4().hex[:8]}", role="warehouse_admin"
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


def _line_picked_at(db_session: Session, line_id: UUID):
    db_session.expire_all()
    return db_session.query(DocumentLine).filter(DocumentLine.id == line_id).one().picked_at


def test_pick_writes_picked_at_and_second_confirm_updates_it(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _send_order_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
        assert doc.status_code == 200, doc.text
        line = doc.json()["lines"][0]
        line_id = UUID(line["id"])
        assert line["picked_at"] is None

        required_qty = max(1, int(float(line["qty_required"])))
        assert required_qty >= 2, "test uchun kamida 2 dona kerak"

        first = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={"delta": 1, "request_id": f"pick-{uuid.uuid4().hex}"},
        )
        assert first.status_code == 200, first.text
        assert first.json()["line"]["picked_at"] is not None
        first_at = _line_picked_at(db_session, line_id)
        assert first_at is not None

        second = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={"delta": 1, "request_id": f"pick-{uuid.uuid4().hex}"},
        )
        assert second.status_code == 200, second.text
        second_at = _line_picked_at(db_session, line_id)
        assert second_at is not None
        # Oxirgi tasdiq vaqti saqlanadi (orqaga ketmaydi).
        assert second_at >= first_at
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_full_unpick_clears_picked_at(client: TestClient, db_session: Session) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _send_order_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
        line = doc.json()["lines"][0]
        line_id = UUID(line["id"])
        required_qty = max(1, int(float(line["qty_required"])))
        pick_delta = min(2, required_qty)

        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={"delta": pick_delta, "request_id": f"pick-{uuid.uuid4().hex}"},
        )
        assert pick.status_code == 200, pick.text
        assert _line_picked_at(db_session, line_id) is not None

        if pick_delta > 1:
            partial = client.post(
                f"/api/v1/picking/lines/{line_id}/unpick",
                json={
                    "delta": 1,
                    "reason": "wrong_location",
                    "request_id": f"unpick-{uuid.uuid4().hex}",
                },
            )
            assert partial.status_code == 200, partial.text
            # Qisman qaytarish — hali terilgan miqdor bor, vaqt saqlanadi.
            assert _line_picked_at(db_session, line_id) is not None

        rest = client.post(
            f"/api/v1/picking/lines/{line_id}/unpick",
            json={
                "delta": 1,
                "reason": "wrong_location",
                "request_id": f"unpick-{uuid.uuid4().hex}",
            },
        )
        assert rest.status_code == 200, rest.text
        assert rest.json()["line"]["qty_picked"] == 0
        assert rest.json()["line"]["picked_at"] is None
        assert _line_picked_at(db_session, line_id) is None
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_skip_line_clears_picked_at(client: TestClient, db_session: Session) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _send_order_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
        line_id = UUID(doc.json()["lines"][0]["id"])

        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={"delta": 1, "request_id": f"pick-{uuid.uuid4().hex}"},
        )
        assert pick.status_code == 200, pick.text
        assert _line_picked_at(db_session, line_id) is not None

        skip = client.post(
            f"/api/v1/picking/lines/{line_id}/skip",
            json={"reason": "out_of_stock"},
        )
        assert skip.status_code == 200, skip.text
        assert _line_picked_at(db_session, line_id) is None
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_document_detail_exposes_assignment_timestamps(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _send_order_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        res = client.get(f"/api/v1/picking/documents/{doc_id}")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["first_assigned_at"] is not None
        assert body["last_assigned_at"] is None
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc.first_assigned_at is not None
