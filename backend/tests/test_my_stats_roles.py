"""Xodimning o'z ko'rsatkichi (/picking/my-stats) rolga qarab hisoblanishi.

Yig'uvchi controllerga yuborgan zahoti ko'radi — controller yakunlashini kutsa,
kun bo'yi o'z ishini 0 deb ko'rardi. Bekor qilingan terish ham kiradi: mobil
raqam admin paneldagidan kam bo'lmasligi kerak.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.core.business_time import BUSINESS_TZ
from app.main import app
from app.models.document import Document
from tests.test_archive_revert_return import _complete_order_via_controller
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def _my_stats(client: TestClient, days: int = 7) -> dict:
    res = client.get("/api/v1/picking/my-stats", params={"days": days})
    assert res.status_code == 200, res.text
    return res.json()


def _send_and_pick(client: TestClient, db_session: Session, order, picker) -> str:
    admin = _mk_user(db_session, username=f"adm-ms-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        send = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        assert send.status_code == 200, send.text
        doc_id = send.json()["pick_task_id"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
        line = doc.json()["lines"][0]
        client.post(
            f"/api/v1/picking/lines/{line['id']}/pick",
            json={"delta": int(line["qty_required"]), "request_id": f"p-{uuid.uuid4().hex}"},
        )
        client.post(f"/api/v1/picking/documents/{doc_id}/complete")
        controller = _mk_user(
            db_session, username=f"ctl-ms-{uuid.uuid4().hex[:8]}", role="inventory_controller"
        )
        client.post(
            f"/api/v1/picking/documents/{doc_id}/send-to-controller",
            json={"controller_user_id": str(controller.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    return doc_id


def test_picker_sees_work_before_the_controller_finishes(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    _send_and_pick(client, db_session, order, picker)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        stats = _my_stats(client)
        assert stats["total_completed"] >= 1
        assert stats["completed_today"] >= 1, "controller kutilmasdan ko'rinishi kerak"
        assert len(stats["by_day"]) == 7
        assert stats["by_day"][-1]["count"] >= 1, "bugungi ustun to'lgan bo'lishi kerak"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_controller_counts_only_the_documents_it_closed(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _complete_order_via_controller(client, db_session, order, picker)
    controller_id = (
        db_session.query(Document).filter(Document.id == doc_id).one().controlled_by_user_id
    )
    controller = _mk_user(
        db_session, username=f"ctl-x-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )

    # Boshqa controller — bu hujjatni u yopmagan.
    app.dependency_overrides[get_current_user] = lambda: controller
    try:
        assert _my_stats(client)["total_completed"] == 0
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    from app.models.user import User

    closer = db_session.query(User).filter(User.id == controller_id).one()
    app.dependency_overrides[get_current_user] = lambda: closer
    try:
        assert _my_stats(client)["total_completed"] >= 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_cancelled_pick_still_counts_for_the_picker(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    _complete_order_via_controller(client, db_session, order, picker)
    admin = _mk_user(db_session, username=f"adm-mc-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        before = _my_stats(client)["total_completed"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        assert (
            client.patch(
                f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"}
            ).status_code
            == 200
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        after = _my_stats(client)["total_completed"]
        assert after == before, "bekor qilish xodimning raqamini kamaytirmasligi kerak"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_evening_work_stays_on_its_own_day(client: TestClient, db_session: Session) -> None:
    """23:30 (ombor vaqti) — UTC'da ertangi kun, lekin o'z kunida qolishi kerak."""
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _send_and_pick(client, db_session, order, picker)

    today = datetime.now(BUSINESS_TZ).date()
    evening = datetime.combine(today, datetime.min.time(), tzinfo=BUSINESS_TZ) + timedelta(
        hours=23, minutes=30
    )
    doc = db_session.query(Document).filter(Document.id == uuid.UUID(doc_id)).one()
    # UTC'ga o'girib yozamiz: sinov bazasi (sqlite) ofsetni saqlamaydi, shuning uchun
    # "ombor vaqti 23:30" ni UTC 18:30 sifatida beramiz — production'dagi timestamptz
    # ham xuddi shu lahzani qaytaradi.
    doc.sent_to_controller_at = evening.astimezone(timezone.utc)
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        stats = _my_stats(client)
        assert stats["by_day"][-1]["date"] == today.isoformat()
        assert stats["by_day"][-1]["count"] >= 1
        assert stats["completed_today"] >= 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)
