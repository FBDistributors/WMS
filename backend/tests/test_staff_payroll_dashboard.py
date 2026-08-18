"""Dashboard staff-payroll: xodim ilovasi bilan paritet va davr qoidalari."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.document import Document, DocumentLine
from app.models.safe_cancel_return import SafeCancelReturnLine, SafeCancelReturnSession
from app.models.user import User
from app.services.order_source_group import SOURCE_GROUP_REGION
from app.services.payroll_rates import DEFAULT_RATES
from tests.test_payroll_orikzor_region import (
    AFTER_CUTOVER,
    _mk_picker,
    _mk_sent_doc,
    _offset_for_period,
    _period_stats,
)


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: user


def _clear():
    app.dependency_overrides.pop(get_current_user, None)


def _mk_admin(db: Session) -> User:
    admin = User(
        username=f"adm-pay-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def _staff_payroll(client: TestClient, admin: User, offset: int) -> dict:
    _as(admin)
    try:
        resp = client.get(f"/api/v1/dashboard/staff-payroll?offset={offset}")
        assert resp.status_code == 200, resp.text
        return resp.json()
    finally:
        _clear()


def test_admin_totals_match_worker_app_exactly(client: TestClient, db_session: Session):
    """Paritet: admin jadvalidagi summa = xodim ilovasidagi summa, aynan."""
    picker = _mk_picker(db_session)
    admin = _mk_admin(db_session)
    sent_at = datetime(AFTER_CUTOVER.year, AFTER_CUTOVER.month, 27, 10, 0, 0, tzinfo=timezone.utc)
    _mk_sent_doc(db_session, picker, source="orikzor", sent_at=sent_at, lines=2)
    _mk_sent_doc(db_session, picker, source="smartup", sent_at=sent_at, lines=3)
    offset = _offset_for_period(AFTER_CUTOVER)

    worker = _period_stats(client, picker, offset)
    admin_body = _staff_payroll(client, admin, offset)

    row = next(r for r in admin_body["pickers"] if r["user_id"] == str(picker.id))
    wt = worker["totals"]
    assert row["total_amount"] == wt["amount"]
    assert row["amount_shahar"] == wt["shahar"]["amount"]
    assert row["amount_region"] == wt["region"]["amount"]
    assert row["positions"] == wt["positions"]
    assert row["orders"] == wt["orders"]
    assert admin_body["period_from"] == worker["period_from"]
    assert admin_body["rates"]["picker_shahar"] == worker["rate_shahar"]
    assert admin_body["rates"]["picker_region"] == worker["rate_region"]


def test_orikzor_counts_in_region_amount(client: TestClient, db_session: Session):
    picker = _mk_picker(db_session)
    admin = _mk_admin(db_session)
    sent_at = datetime(AFTER_CUTOVER.year, AFTER_CUTOVER.month, 28, 10, 0, 0, tzinfo=timezone.utc)
    _mk_sent_doc(db_session, picker, source="orikzor", sent_at=sent_at, lines=2)

    body = _staff_payroll(client, admin, _offset_for_period(AFTER_CUTOVER))

    row = next(r for r in body["pickers"] if r["user_id"] == str(picker.id))
    assert row["positions_region"] == 2
    assert row["positions_shahar"] == 0
    expected = float(Decimal(2) * DEFAULT_RATES[("picker", SOURCE_GROUP_REGION)])
    assert row["amount_region"] == expected
    assert row["total_amount"] == expected
    assert body["totals"]["pickers_total"] >= expected


def test_controller_counted_only_from_completed(client: TestClient, db_session: Session):
    picker = _mk_picker(db_session)
    admin = _mk_admin(db_session)
    ctrl = User(
        username=f"ctrl-pay-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="inventory_controller",
        is_active=True,
    )
    db_session.add(ctrl)
    db_session.commit()
    db_session.refresh(ctrl)
    sent_at = datetime(AFTER_CUTOVER.year, AFTER_CUTOVER.month, 27, 10, 0, 0, tzinfo=timezone.utc)

    # picked holatda — controller hali sanalmaydi
    doc = _mk_sent_doc(db_session, picker, source="smartup", sent_at=sent_at, lines=2)
    doc.controlled_by_user_id = ctrl.id
    db_session.commit()

    body = _staff_payroll(client, admin, _offset_for_period(AFTER_CUTOVER))
    assert str(ctrl.id) not in [r["user_id"] for r in body["controllers"]]

    # yakunlangach — sanaladi
    doc.status = "completed"
    doc.completed_at = sent_at
    db_session.commit()

    body = _staff_payroll(client, admin, _offset_for_period(AFTER_CUTOVER))
    row = next(r for r in body["controllers"] if r["user_id"] == str(ctrl.id))
    assert row["positions"] == 2
    expected = float(Decimal(2) * DEFAULT_RATES[("controller", "shahar")])
    assert row["total_amount"] == expected


def test_cancelled_picking_counts_for_picker(client: TestClient, db_session: Session):
    picker = _mk_picker(db_session)
    admin = _mk_admin(db_session)
    sent_at = datetime(AFTER_CUTOVER.year, AFTER_CUTOVER.month, 29, 10, 0, 0, tzinfo=timezone.utc)
    doc = _mk_sent_doc(db_session, picker, source="smartup", sent_at=sent_at, lines=2)
    # Bekor qilingan: hujjat cancelled, ish safe-cancel sessiyasida qayd etilgan.
    doc.status = "cancelled"
    doc.sent_to_controller_at = None

    from app.models.location import Location
    from app.models.product import Product
    from app.models.stock import StockLot

    loc = Location(
        code=f"S-{uuid.uuid4().hex[:6]}",
        barcode_value=f"S-{uuid.uuid4().hex[:6]}",
        name="Bin",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    product = Product(
        external_source="test",
        external_id=f"pay-{uuid.uuid4().hex[:8]}",
        name="Prod",
        sku=f"SKU-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db_session.add_all([loc, product])
    db_session.flush()
    lot = StockLot(product_id=product.id, batch="b1", expiry_date=None)
    db_session.add(lot)
    db_session.flush()

    session = SafeCancelReturnSession(
        order_id=doc.order_id,
        document_id=doc.id,
        picker_user_id=picker.id,
        status="completed",
        created_at=sent_at,
    )
    db_session.add(session)
    db_session.flush()
    dline = db_session.query(DocumentLine).filter(DocumentLine.document_id == doc.id).first()
    db_session.add(
        SafeCancelReturnLine(
            session_id=session.id,
            document_line_id=dline.id,
            expected_location_id=loc.id,
            expected_location_code=loc.code,
            product_id=product.id,
            lot_id=lot.id,
            product_name="P",
            qty_to_return=3,
            product_confirmed=True,
        )
    )
    db_session.commit()

    body = _staff_payroll(client, admin, _offset_for_period(AFTER_CUTOVER))
    row = next((r for r in body["pickers"] if r["user_id"] == str(picker.id)), None)
    assert row is not None
    # Bekor sessiyasidagi 1 pozitsiya sanalgan.
    assert row["positions"] >= 1
