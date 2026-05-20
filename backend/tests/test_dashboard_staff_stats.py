"""Dashboard picking-staff-stats aggregation (documents SO completed)."""
from __future__ import annotations

from datetime import datetime, timezone

from datetime import date

from app.api.v1.endpoints.dashboard import (
    _aggregate_staff_by_user_column,
    _count_completed_documents,
    _resolve_stats_period,
)
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
