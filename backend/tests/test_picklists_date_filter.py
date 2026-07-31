"""Pick list ro'yxatida sana filtri (ombor vaqti bo'yicha).

Arxiv — yakunlangan vaqt, Jarayon — yaratilgan vaqt. Chegaralar biznes-tz da
olinadi: kechqurun yakunlangan hujjat o'sha kunda qolishi kerak, ertangi kunda emas.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.core.business_time import BUSINESS_TZ
from app.main import app
from app.models.document import Document
from tests.test_archive_revert_return import _complete_order_via_controller
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def _archived_rows(client: TestClient, **params) -> list[dict]:
    res = client.get(
        "/api/v1/picking/documents",
        params={"process_scope": "archived", "limit": 200, **params},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _set_completed_at(db_session: Session, doc_id, moment: datetime) -> None:
    doc = db_session.query(Document).filter(Document.id == doc_id).one()
    doc.completed_at = moment
    db_session.commit()


def test_archive_date_filter_uses_completed_at(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _complete_order_via_controller(client, db_session, order, picker)
    admin = _mk_user(db_session, username=f"adm-df-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    day = date(2026, 3, 17)
    _set_completed_at(
        db_session, doc_id, datetime.combine(day, time(14, 30), tzinfo=BUSINESS_TZ)
    )

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        same_day = _archived_rows(client, date_from=day.isoformat(), date_to=day.isoformat())
        assert any(r["id"] == str(doc_id) for r in same_day)

        next_day = day + timedelta(days=1)
        other = _archived_rows(
            client, date_from=next_day.isoformat(), date_to=next_day.isoformat()
        )
        assert all(r["id"] != str(doc_id) for r in other)

        # Faqat quyi chegara — o'sha kundan boshlab hammasi.
        from_only = _archived_rows(client, date_from=day.isoformat())
        assert any(r["id"] == str(doc_id) for r in from_only)

        # Faqat yuqori chegara — o'sha kungacha.
        before = _archived_rows(client, date_to=(day - timedelta(days=1)).isoformat())
        assert all(r["id"] != str(doc_id) for r in before)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_late_evening_stays_in_its_business_day(
    client: TestClient, db_session: Session
) -> None:
    """23:30 (ombor vaqti) yakunlangan hujjat UTC'da ertangi kun — filtr adashmasin."""
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _complete_order_via_controller(client, db_session, order, picker)
    admin = _mk_user(db_session, username=f"adm-ev-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    day = date(2026, 3, 18)
    _set_completed_at(
        db_session, doc_id, datetime.combine(day, time(23, 30), tzinfo=BUSINESS_TZ)
    )

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        rows = _archived_rows(client, date_from=day.isoformat(), date_to=day.isoformat())
        assert any(r["id"] == str(doc_id) for r in rows)

        next_day = (day + timedelta(days=1)).isoformat()
        rows_next = _archived_rows(client, date_from=next_day, date_to=next_day)
        assert all(r["id"] != str(doc_id) for r in rows_next)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_reversed_range_is_rejected(client: TestClient, db_session: Session) -> None:
    admin = _mk_user(db_session, username=f"adm-rev-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.get(
            "/api/v1/picking/documents",
            params={"process_scope": "archived", "date_from": "2026-03-20", "date_to": "2026-03-19"},
        )
        assert res.status_code == 400, res.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_no_dates_keeps_previous_behaviour(client: TestClient, db_session: Session) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _complete_order_via_controller(client, db_session, order, picker)
    admin = _mk_user(db_session, username=f"adm-nd-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        assert any(r["id"] == str(doc_id) for r in _archived_rows(client))
    finally:
        app.dependency_overrides.pop(get_current_user, None)
