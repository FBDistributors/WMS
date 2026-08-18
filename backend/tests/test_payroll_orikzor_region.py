"""O'rikzor buyurtmalari tarifi: 26.07.2026 davridan region, oldingi davrlar shahar.

Ish oqimi guruhi (navbat tablari, source_group_conditions) o'zgarmaydi — faqat
pul/reyting hisobidagi guruhlash (payroll_source_group).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.document import Document, DocumentLine
from app.models.order import Order, OrderWmsState
from app.models.user import User
from app.services.order_source_group import (
    ORIKZOR_REGION_RATE_FROM,
    SOURCE_GROUP_CITY,
    SOURCE_GROUP_REGION,
    order_source_group,
    payroll_source_group,
)
from app.services.payroll_rates import DEFAULT_RATES

AFTER_CUTOVER = ORIKZOR_REGION_RATE_FROM  # 2026-07-26 davri
BEFORE_CUTOVER = date(2026, 6, 26)  # oldingi davr boshi


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: user


def _clear():
    app.dependency_overrides.pop(get_current_user, None)


# --- payroll_source_group birligi ---


def test_payroll_group_orikzor_region_after_cutover():
    assert payroll_source_group("orikzor", AFTER_CUTOVER) == SOURCE_GROUP_REGION
    assert payroll_source_group("orikzor_manual", AFTER_CUTOVER) == SOURCE_GROUP_REGION
    assert payroll_source_group("diller", AFTER_CUTOVER) == SOURCE_GROUP_REGION
    assert payroll_source_group("smartup", AFTER_CUTOVER) == SOURCE_GROUP_CITY


def test_payroll_group_orikzor_city_before_cutover():
    """Retroaktivlik: eski davrlar eskicha — to'langan oy qayta hisoblanmasin."""
    assert payroll_source_group("orikzor", BEFORE_CUTOVER) == SOURCE_GROUP_CITY
    assert payroll_source_group("diller", BEFORE_CUTOVER) == SOURCE_GROUP_REGION
    assert payroll_source_group("smartup", BEFORE_CUTOVER) == SOURCE_GROUP_CITY


def test_workflow_group_unchanged():
    """Ish oqimi guruhi (navbat tablari) o'rikzor uchun shahar bo'lib qoladi."""

    class _O:
        source = "orikzor"

    assert order_source_group(_O()) == SOURCE_GROUP_CITY


# --- xodim pul hisobi (/picking/my-period-stats) ---


def _mk_picker(db: Session) -> User:
    u = User(
        username=f"pk-orz-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _mk_sent_doc(
    db: Session,
    picker: User,
    *,
    source: str,
    sent_at: datetime,
    lines: int = 2,
) -> Document:
    order = Order(
        source=source,
        source_external_id=f"orz-{uuid.uuid4().hex[:10]}",
        order_number=f"N{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="picked")
    db.add(order)
    db.flush()
    doc = Document(
        doc_no=f"SO-{uuid.uuid4().hex[:8]}",
        doc_type="SO",
        status="picked",
        order_id=order.id,
        assigned_to_user_id=picker.id,
        sent_to_controller_at=sent_at,
    )
    db.add(doc)
    db.flush()
    for i in range(lines):
        db.add(
            DocumentLine(
                document_id=doc.id,
                product_name=f"P{i}",
                location_code="L1",
                required_qty=3,
                picked_qty=3,
            )
        )
    db.commit()
    return doc


def _period_stats(client: TestClient, picker: User, offset: int) -> dict:
    _as(picker)
    try:
        resp = client.get(f"/api/v1/picking/my-period-stats?offset={offset}")
        assert resp.status_code == 200, resp.text
        return resp.json()
    finally:
        _clear()


def _offset_for_period(period_start: date) -> int:
    """Bugungi sanadan `period_start` davri uchun offset (26 -> 25 davrlari)."""
    today = date.today()
    y, m = today.year, today.month
    if today.day < 26:
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    months_now = y * 12 + (m - 1)
    months_target = period_start.year * 12 + (period_start.month - 1)
    return months_target - months_now


def test_period_stats_orikzor_paid_as_region_after_cutover(client: TestClient, db_session: Session):
    picker = _mk_picker(db_session)
    sent_at = datetime(
        AFTER_CUTOVER.year, AFTER_CUTOVER.month, 27, 10, 0, 0, tzinfo=timezone.utc
    )
    _mk_sent_doc(db_session, picker, source="orikzor", sent_at=sent_at, lines=2)

    body = _period_stats(client, picker, _offset_for_period(AFTER_CUTOVER))

    totals = body["totals"]
    assert totals["region"]["orders"] == 1
    assert totals["region"]["positions"] == 2
    assert totals["shahar"]["orders"] == 0
    expected = float(Decimal(2) * DEFAULT_RATES[("picker", SOURCE_GROUP_REGION)])
    assert totals["region"]["amount"] == expected


def test_period_stats_orikzor_stays_city_before_cutover(client: TestClient, db_session: Session):
    picker = _mk_picker(db_session)
    sent_at = datetime(
        BEFORE_CUTOVER.year, BEFORE_CUTOVER.month, 27, 10, 0, 0, tzinfo=timezone.utc
    )
    _mk_sent_doc(db_session, picker, source="orikzor", sent_at=sent_at, lines=2)

    body = _period_stats(client, picker, _offset_for_period(BEFORE_CUTOVER))

    totals = body["totals"]
    assert totals["shahar"]["orders"] == 1
    assert totals["region"]["orders"] == 0
    expected = float(Decimal(2) * DEFAULT_RATES[("picker", SOURCE_GROUP_CITY)])
    assert totals["shahar"]["amount"] == expected


def test_period_stats_smartup_and_diller_unchanged(client: TestClient, db_session: Session):
    picker = _mk_picker(db_session)
    sent_at = datetime(
        AFTER_CUTOVER.year, AFTER_CUTOVER.month, 28, 10, 0, 0, tzinfo=timezone.utc
    )
    _mk_sent_doc(db_session, picker, source="smartup", sent_at=sent_at, lines=1)
    _mk_sent_doc(db_session, picker, source="diller", sent_at=sent_at, lines=1)

    body = _period_stats(client, picker, _offset_for_period(AFTER_CUTOVER))

    totals = body["totals"]
    assert totals["shahar"]["orders"] == 1  # smartup
    assert totals["region"]["orders"] == 1  # diller


# --- admin reytingi (dashboard staff-stats) ---


def test_dashboard_staff_stats_orikzor_in_region_group(client: TestClient, db_session: Session):
    picker = _mk_picker(db_session)
    admin = User(
        username=f"adm-orz-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()
    sent_at = datetime(
        AFTER_CUTOVER.year, AFTER_CUTOVER.month, 27, 10, 0, 0, tzinfo=timezone.utc
    )
    _mk_sent_doc(db_session, picker, source="orikzor", sent_at=sent_at, lines=2)

    date_q = f"date_from={AFTER_CUTOVER.isoformat()}&date_to={AFTER_CUTOVER.year}-12-31"
    _as(admin)
    try:
        region = client.get(f"/api/v1/dashboard/picking-staff-stats?group=region&{date_q}")
        city = client.get(f"/api/v1/dashboard/picking-staff-stats?group=shahar&{date_q}")
    finally:
        _clear()

    assert region.status_code == 200, region.text
    assert city.status_code == 200, city.text
    region_ids = [r["user_id"] for r in region.json()["pickers"]]
    city_ids = [r["user_id"] for r in city.json()["pickers"]]
    assert str(picker.id) in region_ids
    assert str(picker.id) not in city_ids
