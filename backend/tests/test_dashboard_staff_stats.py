"""Dashboard picking-staff-stats aggregation (documents SO completed)."""
from __future__ import annotations

from datetime import datetime, timezone

from datetime import date

from app.main import app
from app.auth.deps import get_current_user
from app.api.v1.endpoints.dashboard import (
    PICKER_COUNTED_DOC_STATUSES,
    _aggregate_staff_by_user_column,
    _count_completed_documents,
    _picker_activity_at_expr,
    _resolve_stats_period,
)
import app.api.v1.endpoints.dashboard as dashboard_module
from app.models.document import Document, DocumentLine
from app.models.user import User
from app.auth.security import get_password_hash


def test_aggregate_picker_and_controller(db_session):
    p = User(
        username="picker_stat",
        password_hash=get_password_hash("x"),
        role="picker",
        full_name="Picker One",
        is_active=True,
    )
    c = User(
        username="ctrl_stat",
        password_hash=get_password_hash("x"),
        role="inventory_controller",
        full_name="Controller One",
        is_active=True,
    )
    db_session.add_all([p, c])
    db_session.flush()

    d = Document(
        doc_no="SO-STAT-1",
        doc_type="SO",
        status="completed",
        assigned_to_user_id=p.id,
        controlled_by_user_id=c.id,
        updated_at=datetime(2026, 3, 15, 12, 0, 0, tzinfo=timezone.utc),
    )
    db_session.add(d)
    db_session.flush()
    db_session.add_all(
        [
            DocumentLine(
                document_id=d.id,
                product_name="A",
                location_code="L1",
                required_qty=10,
                picked_qty=10,
            ),
            DocumentLine(
                document_id=d.id,
                product_name="B",
                location_code="L1",
                required_qty=5,
                picked_qty=3,
            ),
        ]
    )
    db_session.commit()

    pickers = _aggregate_staff_by_user_column(db_session, Document.assigned_to_user_id, None, None)
    ctrls = _aggregate_staff_by_user_column(db_session, Document.controlled_by_user_id, None, None)

    assert len(pickers) == 1
    assert pickers[0].user_id == p.id
    assert pickers[0].documents_count == 1
    assert pickers[0].lines_count == 2
    assert pickers[0].total_picked_qty == 13.0

    assert len(ctrls) == 1
    assert ctrls[0].user_id == c.id
    assert ctrls[0].total_picked_qty == 13.0


def test_picker_counts_from_sent_to_controller(db_session):
    """Yig'uvchi statistikasi controllerga yuborilganidan (status=picked,
    sent_to_controller_at) hisoblanadi; controller esa faqat yakunlanganlardan."""
    p = User(
        username="picker_sent",
        password_hash=get_password_hash("x"),
        role="picker",
        full_name="Picker Sent",
        is_active=True,
    )
    c = User(
        username="ctrl_sent",
        password_hash=get_password_hash("x"),
        role="inventory_controller",
        full_name="Controller Sent",
        is_active=True,
    )
    db_session.add_all([p, c])
    db_session.flush()

    # Controllerga yuborilgan, hali yakunlanmagan hujjat.
    d = Document(
        doc_no="SO-SENT-1",
        doc_type="SO",
        status="picked",
        assigned_to_user_id=p.id,
        controlled_by_user_id=c.id,
        sent_to_controller_at=datetime(2026, 7, 1, 9, 0, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 7, 2, 9, 0, 0, tzinfo=timezone.utc),
    )
    db_session.add(d)
    db_session.flush()
    db_session.add(
        DocumentLine(
            document_id=d.id,
            product_name="A",
            location_code="L1",
            required_qty=4,
            picked_qty=4,
        )
    )
    db_session.commit()

    pickers = _aggregate_staff_by_user_column(
        db_session,
        Document.assigned_to_user_id,
        None,
        None,
        statuses=PICKER_COUNTED_DOC_STATUSES,
        ts_col=_picker_activity_at_expr(),
    )
    assert len(pickers) == 1
    assert pickers[0].documents_count == 1
    assert pickers[0].total_picked_qty == 4.0

    # Controller hali yakunlamagan — uning statistikasiga tushmaydi.
    ctrls = _aggregate_staff_by_user_column(
        db_session, Document.controlled_by_user_id, None, None
    )
    assert ctrls == []

    # Sana filtri sent_to_controller_at bo'yicha (1-iyul), updated_at (2-iyul) emas.
    in_range = _aggregate_staff_by_user_column(
        db_session,
        Document.assigned_to_user_id,
        date(2026, 7, 1),
        date(2026, 7, 1),
        statuses=PICKER_COUNTED_DOC_STATUSES,
        ts_col=_picker_activity_at_expr(),
    )
    assert len(in_range) == 1
    out_of_range = _aggregate_staff_by_user_column(
        db_session,
        Document.assigned_to_user_id,
        date(2026, 7, 3),
        date(2026, 7, 4),
        statuses=PICKER_COUNTED_DOC_STATUSES,
        ts_col=_picker_activity_at_expr(),
    )
    assert out_of_range == []


def test_aggregate_respects_date_filter(db_session):
    u = User(
        username="picker_d2",
        password_hash=get_password_hash("x"),
        role="picker",
        full_name="P2",
        is_active=True,
    )
    db_session.add(u)
    db_session.flush()

    old = Document(
        doc_no="SO-OLD",
        doc_type="SO",
        status="completed",
        assigned_to_user_id=u.id,
        updated_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
    )
    new = Document(
        doc_no="SO-NEW",
        doc_type="SO",
        status="completed",
        assigned_to_user_id=u.id,
        updated_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )
    db_session.add_all([old, new])
    db_session.flush()
    for doc, qty in ((old, 1.0), (new, 2.0)):
        db_session.add(
            DocumentLine(
                document_id=doc.id,
                product_name="X",
                location_code="L",
                required_qty=qty,
                picked_qty=qty,
            )
        )
    db_session.commit()

    rows = _aggregate_staff_by_user_column(
        db_session, Document.assigned_to_user_id, date(2026, 5, 1), date(2026, 6, 30)
    )
    assert len(rows) == 1
    assert rows[0].documents_count == 1
    assert rows[0].total_picked_qty == 2.0


def test_count_completed_documents_and_period(db_session):
    u = User(
        username="picker_cnt",
        password_hash=get_password_hash("x"),
        role="picker",
        full_name="P",
        is_active=True,
    )
    db_session.add(u)
    db_session.flush()

    d1 = Document(
        doc_no="SO-C1",
        doc_type="SO",
        status="completed",
        assigned_to_user_id=u.id,
        completed_at=datetime(2026, 6, 1, 10, 0, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 6, 1, 10, 0, 0, tzinfo=timezone.utc),
    )
    d2 = Document(
        doc_no="SO-C2",
        doc_type="SO",
        status="completed",
        assigned_to_user_id=u.id,
        completed_at=datetime(2026, 6, 3, 10, 0, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 6, 3, 10, 0, 0, tzinfo=timezone.utc),
    )
    d3 = Document(
        doc_no="SO-C3",
        doc_type="SO",
        status="completed",
        assigned_to_user_id=u.id,
        completed_at=datetime(2026, 6, 10, 10, 0, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 6, 10, 10, 0, 0, tzinfo=timezone.utc),
    )
    db_session.add_all([d1, d2, d3])
    db_session.commit()

    assert _count_completed_documents(db_session, date(2026, 6, 1), date(2026, 6, 3)) == 2
    assert _count_completed_documents(db_session, date(2026, 6, 1), date(2026, 6, 10)) == 3

    eff_from, eff_to, days = _resolve_stats_period(date(2026, 6, 1), date(2026, 6, 3))
    assert eff_from == date(2026, 6, 1)
    assert eff_to == date(2026, 6, 3)
    assert days == 3
    period_count = _count_completed_documents(db_session, eff_from, eff_to)
    assert period_count == 2
    assert round(period_count / days, 1) == round(2 / 3, 1)


def test_picking_order_stats_avg_all_time_endpoint(client, db_session, monkeypatch):
    admin = User(
        username="admin_dash",
        password_hash=get_password_hash("x"),
        role="warehouse_admin",
        is_active=True,
        full_name="Admin Dashboard",
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)

    monkeypatch.setattr(dashboard_module, "_today_business", lambda: date(2026, 6, 10))

    d1 = Document(
        doc_no="SO-C1",
        doc_type="SO",
        status="completed",
        completed_at=datetime(2026, 6, 1, 10, 0, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 6, 1, 10, 0, 0, tzinfo=timezone.utc),
    )
    d2 = Document(
        doc_no="SO-C2",
        doc_type="SO",
        status="completed",
        completed_at=datetime(2026, 6, 3, 10, 0, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 6, 3, 10, 0, 0, tzinfo=timezone.utc),
    )
    d3 = Document(
        doc_no="SO-C3",
        doc_type="SO",
        status="completed",
        completed_at=datetime(2026, 6, 10, 10, 0, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 6, 10, 10, 0, 0, tzinfo=timezone.utc),
    )
    db_session.add_all([d1, d2, d3])
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res_false = client.get(
            "/api/v1/dashboard/picking-order-stats",
            params={"date_from": "2026-06-01", "date_to": "2026-06-03"},
        )
        assert res_false.status_code == 200
        data_false = res_false.json()
        assert data_false["date_from"] == "2026-06-01"
        assert data_false["date_to"] == "2026-06-03"
        assert data_false["completed_today"] == 1
        assert data_false["completed_in_period"] == 2
        assert data_false["days_in_period"] == 3
        assert data_false["avg_completed_per_day"] == 0.7

        res_true = client.get(
            "/api/v1/dashboard/picking-order-stats",
            params={
                "date_from": "2026-06-01",
                "date_to": "2026-06-03",
                "avg_all_time": "true",
            },
        )
        assert res_true.status_code == 200
        data_true = res_true.json()
        assert data_true["date_from"] == "2026-06-01"
        assert data_true["date_to"] == "2026-06-03"
        assert data_true["completed_today"] == 1
        assert data_true["completed_in_period"] == 2
        assert data_true["days_in_period"] == 10
        assert data_true["avg_completed_per_day"] == 0.3
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_picking_order_stats_daily_breakdown(client, db_session, monkeypatch):
    admin = User(
        username="admin_daily",
        password_hash=get_password_hash("x"),
        role="warehouse_admin",
        is_active=True,
        full_name="Admin Daily",
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)

    monkeypatch.setattr(dashboard_module, "_today_business", lambda: date(2026, 6, 10))

    # 6/10 (bugun) ichida, 6/1 7-kunlik oynadan tashqarida
    db_session.add_all(
        [
            Document(
                doc_no="SO-D1",
                doc_type="SO",
                status="completed",
                completed_at=datetime(2026, 6, 10, 9, 0, 0, tzinfo=timezone.utc),
                updated_at=datetime(2026, 6, 10, 9, 0, 0, tzinfo=timezone.utc),
            ),
            Document(
                doc_no="SO-D2",
                doc_type="SO",
                status="completed",
                completed_at=datetime(2026, 6, 1, 9, 0, 0, tzinfo=timezone.utc),
                updated_at=datetime(2026, 6, 1, 9, 0, 0, tzinfo=timezone.utc),
            ),
        ]
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.get("/api/v1/dashboard/picking-order-stats")
        assert res.status_code == 200
        daily = res.json()["daily"]
        assert len(daily) == 7
        assert daily[0]["date"] == "2026-06-04"
        assert daily[-1]["date"] == "2026-06-10"
        assert daily[-1]["count"] == 1
        assert sum(p["count"] for p in daily) == 1  # 6/1 oynadan tashqarida
    finally:
        app.dependency_overrides.pop(get_current_user, None)
