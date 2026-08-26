"""UZUM MARKET yirik buyurtmasi (chegaradan ORTIQ) region tarifida to'lanadi.

Chegara bazada (payroll_big_order_thresholds, sanali, admin o'zgartiradi),
default 20 mln. Qoida BIG_ORDER_REGION_RATE_FROM (26.07.2026) davridan.
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
from app.models.payroll_rate import PayrollBigOrderThreshold
from app.models.user import User
from app.services.order_source_group import (
    BIG_ORDER_REGION_RATE_FROM,
    SOURCE_GROUP_CITY,
    SOURCE_GROUP_REGION,
    payroll_group_for_order,
)
from app.services.payroll_rates import DEFAULT_RATES, load_big_order_threshold
from tests.test_payroll_orikzor_region import (
    AFTER_CUTOVER,
    BEFORE_CUTOVER,
    _mk_picker,
    _mk_sent_doc,
    _offset_for_period,
    _period_stats,
)

UZUM = "4146827"
M20 = Decimal("20000000")


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: user


def _clear():
    app.dependency_overrides.pop(get_current_user, None)


def _mk_admin(db: Session) -> User:
    admin = User(
        username=f"adm-uzm-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


# --- qoida birligi ---


def test_group_boundary_strictly_greater():
    kw = dict(as_of=AFTER_CUTOVER, big_order_min=M20)
    # Aynan 20 mln — shahar (qat'iy ORTIQ talab qilinadi).
    assert payroll_group_for_order("smartup", UZUM, M20, **kw) == SOURCE_GROUP_CITY
    assert payroll_group_for_order("smartup", UZUM, M20 + 1, **kw) == SOURCE_GROUP_REGION


def test_group_only_listed_customer():
    kw = dict(as_of=AFTER_CUTOVER, big_order_min=M20)
    assert payroll_group_for_order("smartup", "9999999", Decimal("100000000"), **kw) == SOURCE_GROUP_CITY
    assert payroll_group_for_order("smartup", None, Decimal("100000000"), **kw) == SOURCE_GROUP_CITY
    assert payroll_group_for_order("smartup", UZUM, None, **kw) == SOURCE_GROUP_CITY
    assert payroll_group_for_order("smartup", UZUM, Decimal("500000"), **kw) == SOURCE_GROUP_CITY


def test_group_before_cutover_stays_city():
    assert (
        payroll_group_for_order("smartup", UZUM, Decimal("90000000"), BEFORE_CUTOVER, big_order_min=M20)
        == SOURCE_GROUP_CITY
    )


def test_group_region_sources_unchanged():
    kw = dict(as_of=AFTER_CUTOVER, big_order_min=M20)
    assert payroll_group_for_order("diller", None, None, **kw) == SOURCE_GROUP_REGION
    assert payroll_group_for_order("orikzor", None, None, **kw) == SOURCE_GROUP_REGION


# --- chegara bazadan ---


def test_threshold_loaded_from_db(db_session: Session):
    assert load_big_order_threshold(db_session, AFTER_CUTOVER) == M20  # default
    db_session.add(
        PayrollBigOrderThreshold(amount=Decimal("50000000"), effective_from=AFTER_CUTOVER)
    )
    db_session.commit()
    assert load_big_order_threshold(db_session, AFTER_CUTOVER) == Decimal("50000000")
    # Oldingi davr — eskicha default (sanali printsip).
    assert load_big_order_threshold(db_session, BEFORE_CUTOVER) == M20


# --- xodim hisobi va paritet ---


def test_big_uzum_order_paid_as_region_for_picker(client: TestClient, db_session: Session):
    picker = _mk_picker(db_session)
    sent_at = datetime(AFTER_CUTOVER.year, AFTER_CUTOVER.month, 27, 10, 0, 0, tzinfo=timezone.utc)
    _mk_sent_doc(
        db_session, picker, source="smartup", sent_at=sent_at, lines=2,
        customer_id=UZUM, total_amount=Decimal("25000000"),
    )
    _mk_sent_doc(
        db_session, picker, source="smartup", sent_at=sent_at, lines=1,
        customer_id=UZUM, total_amount=Decimal("5000000"),
    )

    body = _period_stats(client, picker, _offset_for_period(AFTER_CUTOVER))

    totals = body["totals"]
    assert totals["region"]["orders"] == 1  # yirik buyurtma
    assert totals["shahar"]["orders"] == 1  # kichigi shaharda qoladi
    expected = float(Decimal(2) * DEFAULT_RATES[("picker", SOURCE_GROUP_REGION)])
    assert totals["region"]["amount"] == expected


def test_controller_also_paid_region_and_parity(client: TestClient, db_session: Session):
    picker = _mk_picker(db_session)
    admin = _mk_admin(db_session)
    ctrl = User(
        username=f"ctrl-uzm-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="inventory_controller",
        is_active=True,
    )
    db_session.add(ctrl)
    db_session.commit()
    db_session.refresh(ctrl)
    sent_at = datetime(AFTER_CUTOVER.year, AFTER_CUTOVER.month, 28, 10, 0, 0, tzinfo=timezone.utc)
    doc = _mk_sent_doc(
        db_session, picker, source="smartup", sent_at=sent_at, lines=3,
        customer_id=UZUM, total_amount=Decimal("21000000"),
    )
    doc.status = "completed"
    doc.completed_at = sent_at
    doc.controlled_by_user_id = ctrl.id
    db_session.commit()

    # Controller ham region tarifida.
    ctrl_body = _period_stats(client, ctrl, _offset_for_period(AFTER_CUTOVER))
    expected_ctrl = float(Decimal(3) * DEFAULT_RATES[("controller", SOURCE_GROUP_REGION)])
    assert ctrl_body["totals"]["region"]["amount"] == expected_ctrl

    # Paritet: admin jadvali xodim ilovasi bilan bir xil.
    _as(admin)
    try:
        resp = client.get(
            f"/api/v1/dashboard/staff-payroll?offset={_offset_for_period(AFTER_CUTOVER)}"
        )
        assert resp.status_code == 200, resp.text
    finally:
        _clear()
    row = next(r for r in resp.json()["controllers"] if r["user_id"] == str(ctrl.id))
    assert row["total_amount"] == ctrl_body["totals"]["amount"]


def test_changed_threshold_respected_in_period_stats(client: TestClient, db_session: Session):
    picker = _mk_picker(db_session)
    db_session.add(
        PayrollBigOrderThreshold(amount=Decimal("50000000"), effective_from=AFTER_CUTOVER)
    )
    db_session.commit()
    sent_at = datetime(AFTER_CUTOVER.year, AFTER_CUTOVER.month, 29, 10, 0, 0, tzinfo=timezone.utc)
    # 25 mln — yangi chegara (50 mln) dan past, shaharda qoladi.
    _mk_sent_doc(
        db_session, picker, source="smartup", sent_at=sent_at, lines=2,
        customer_id=UZUM, total_amount=Decimal("25000000"),
    )

    body = _period_stats(client, picker, _offset_for_period(AFTER_CUTOVER))
    assert body["totals"]["shahar"]["orders"] == 1
    assert body["totals"]["region"]["orders"] == 0


def test_admin_can_update_threshold_via_api(client: TestClient, db_session: Session):
    admin = _mk_admin(db_session)
    _as(admin)
    try:
        before = client.get("/api/v1/payroll-rates")
        assert before.status_code == 200, before.text
        assert before.json()["big_order_threshold"] == float(M20)

        resp = client.put(
            "/api/v1/payroll-rates",
            json={"rates": [], "big_order_threshold": 30000000},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["big_order_threshold"] == 30000000.0

        after = client.get("/api/v1/payroll-rates")
        assert after.json()["big_order_threshold"] == 30000000.0
    finally:
        _clear()


# --- dashboard reyting filtri ---


def test_dashboard_staff_stats_big_uzum_in_region(client: TestClient, db_session: Session):
    picker = _mk_picker(db_session)
    admin = _mk_admin(db_session)
    sent_at = datetime(AFTER_CUTOVER.year, AFTER_CUTOVER.month, 27, 10, 0, 0, tzinfo=timezone.utc)
    _mk_sent_doc(
        db_session, picker, source="smartup", sent_at=sent_at, lines=2,
        customer_id=UZUM, total_amount=Decimal("22000000"),
    )

    date_q = f"date_from={AFTER_CUTOVER.isoformat()}&date_to={AFTER_CUTOVER.year}-12-31"
    _as(admin)
    try:
        region = client.get(f"/api/v1/dashboard/picking-staff-stats?group=region&{date_q}")
        city = client.get(f"/api/v1/dashboard/picking-staff-stats?group=shahar&{date_q}")
    finally:
        _clear()
    assert str(picker.id) in [r["user_id"] for r in region.json()["pickers"]]
    assert str(picker.id) not in [r["user_id"] for r in city.json()["pickers"]]
