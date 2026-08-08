"""Ish haqi davri (26 -> keyingi oy 25) bo'yicha kunma-kun ko'rsatkich."""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1.endpoints.picking import _payroll_period_bounds
from app.auth.deps import get_current_user
from app.core.business_time import BUSINESS_TZ
from app.main import app
from app.models.document import Document
from tests.test_my_stats_roles import _send_and_pick
from tests.test_order_transition_policy import _seed_allocatable_order


def test_period_runs_from_the_26th_to_the_25th() -> None:
    # Oy o'rtasi — davr o'tgan oyning 26-sidan boshlanadi.
    assert _payroll_period_bounds(date(2026, 8, 8)) == (date(2026, 7, 26), date(2026, 8, 25))
    # 26-sanadan boshlab yangi davr.
    assert _payroll_period_bounds(date(2026, 8, 26)) == (date(2026, 8, 26), date(2026, 9, 25))
    assert _payroll_period_bounds(date(2026, 8, 25)) == (date(2026, 7, 26), date(2026, 8, 25))
    # Yil chegarasi.
    assert _payroll_period_bounds(date(2026, 1, 5)) == (date(2025, 12, 26), date(2026, 1, 25))
    assert _payroll_period_bounds(date(2026, 12, 30)) == (date(2026, 12, 26), date(2027, 1, 25))
    # Oldingi davr.
    assert _payroll_period_bounds(date(2026, 8, 8), -1) == (date(2026, 6, 26), date(2026, 7, 25))


def _period(client: TestClient, offset: int = 0) -> dict:
    res = client.get("/api/v1/picking/my-period-stats", params={"offset": offset})
    assert res.status_code == 200, res.text
    return res.json()


def test_work_lands_on_its_day_with_all_three_numbers(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _send_and_pick(client, db_session, order, picker)

    # Davr ichidagi aniq kunga qo'yamiz (bugundan bir kun oldin — chegaraga tegmasin).
    today = datetime.now(BUSINESS_TZ).date()
    day = today - timedelta(days=1)
    doc = db_session.query(Document).filter(Document.id == uuid.UUID(doc_id)).one()
    doc.sent_to_controller_at = datetime.combine(
        day, time(11, 0), tzinfo=BUSINESS_TZ
    ).astimezone(timezone.utc)
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        body = _period(client)
        start, end = _payroll_period_bounds(today)
        assert body["period_from"] == start.isoformat()
        assert body["period_to"] == end.isoformat()

        row = next((d for d in body["days"] if d["date"] == day.isoformat()), None)
        assert row is not None, "ish o'z kunida ko'rinmadi"
        assert row["orders"] == 1
        assert row["positions"] >= 1
        assert row["qty"] > 0

        assert body["totals"]["orders"] >= 1
        assert body["totals"]["positions"] == sum(d["positions"] for d in body["days"])
        assert body["totals"]["qty"] == sum(d["qty"] for d in body["days"])
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_only_days_with_work_are_returned(client: TestClient, db_session: Session) -> None:
    order, picker = _seed_allocatable_order(db_session)
    _send_and_pick(client, db_session, order, picker)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        body = _period(client)
        assert body["days"], "kamida bitta kun bo'lishi kerak"
        assert all(d["orders"] > 0 for d in body["days"]), "bo'sh kun qaytarilmasin"
        dates = [d["date"] for d in body["days"]]
        assert dates == sorted(dates), "kunlar tartibda bo'lsin"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_previous_period_is_separate(client: TestClient, db_session: Session) -> None:
    order, picker = _seed_allocatable_order(db_session)
    _send_and_pick(client, db_session, order, picker)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        current = _period(client, offset=0)
        previous = _period(client, offset=-1)
        assert previous["period_to"] < current["period_from"]
        assert previous["totals"]["orders"] == 0, "bugungi ish oldingi davrga tushmasin"
    finally:
        app.dependency_overrides.pop(get_current_user, None)
