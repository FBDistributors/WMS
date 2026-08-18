"""close_zombie_orders skripti: hujjatsiz qotgan buyurtmalarni yopish himoyalari."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.auth.security import get_password_hash
from app.models.document import Document
from app.models.order import Order, OrderWmsState
from app.models.user import User
from scripts import close_zombie_orders as script


def _mk_admin(db: Session) -> User:
    admin = User(
        username=f"adm-zmb-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def _mk_order(
    db: Session,
    *,
    status: str,
    age_days: int,
    doc_status: str | None = None,
) -> Order:
    order = Order(
        source="smartup",
        source_external_id=f"zmb-{uuid.uuid4().hex[:10]}",
        order_number=f"Z{uuid.uuid4().hex[:6]}",
        created_at=datetime.now(timezone.utc) - timedelta(days=age_days),
    )
    order.wms_state = OrderWmsState(status=status)
    db.add(order)
    db.flush()
    if doc_status is not None:
        db.add(
            Document(
                doc_no=f"SO-{uuid.uuid4().hex[:8]}",
                doc_type="SO",
                status=doc_status,
                order_id=order.id,
            )
        )
    db.commit()
    db.refresh(order)
    return order


def _run(db: Session, admin: User, apply: bool) -> None:
    import sys
    from unittest.mock import patch

    argv = ["close_zombie_orders", "--by", admin.username] + (["--apply"] if apply else [])
    with patch.object(sys, "argv", argv), patch.object(script, "SessionLocal", lambda: db):
        # SessionLocal patch: test sessiyasi ishlatiladi; script db.close() chaqiradi —
        # fixture yopilishiga xalaqit bermasin deb close ni ham no-op qilamiz.
        with patch.object(db, "close", lambda: None):
            script.main()


def test_doc_less_old_order_completed(db_session: Session):
    admin = _mk_admin(db_session)
    zombie = _mk_order(db_session, status="picking", age_days=60, doc_status=None)

    _run(db_session, admin, apply=True)

    db_session.expire_all()
    assert zombie.wms_state.status == "completed"


def test_order_with_any_doc_untouched(db_session: Session):
    admin = _mk_admin(db_session)
    active = _mk_order(db_session, status="picking", age_days=60, doc_status="in_progress")
    finished = _mk_order(db_session, status="picking", age_days=60, doc_status="completed")

    _run(db_session, admin, apply=True)

    db_session.expire_all()
    assert active.wms_state.status == "picking"
    assert finished.wms_state.status == "picking"  # hujjati bor — A toifaga kirmaydi


def test_young_order_untouched(db_session: Session):
    admin = _mk_admin(db_session)
    young = _mk_order(db_session, status="picked", age_days=3, doc_status=None)

    _run(db_session, admin, apply=True)

    db_session.expire_all()
    assert young.wms_state.status == "picked"


def test_cancelled_doc_order_becomes_cancelled(db_session: Session):
    admin = _mk_admin(db_session)
    stuck = _mk_order(db_session, status="allocated", age_days=60, doc_status="cancelled")

    _run(db_session, admin, apply=True)

    db_session.expire_all()
    assert stuck.wms_state.status == "cancelled"
    assert stuck.wms_state.cancelled_at is not None


def test_dry_run_changes_nothing(db_session: Session):
    admin = _mk_admin(db_session)
    zombie = _mk_order(db_session, status="picking", age_days=60, doc_status=None)
    stuck = _mk_order(db_session, status="picked", age_days=60, doc_status="cancelled")

    _run(db_session, admin, apply=False)

    db_session.expire_all()
    assert zombie.wms_state.status == "picking"
    assert stuck.wms_state.status == "picked"
