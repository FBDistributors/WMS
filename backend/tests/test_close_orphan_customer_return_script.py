"""close_orphan_customer_return skripti: stock'siz bekor qilish + smartup revert."""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy.orm import Session

from app.auth.security import get_password_hash
from app.models.customer_return import CustomerReturn, CustomerReturnLine
from app.models.product import Product
from app.models.smartup_return import SmartupReturn
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from scripts.close_orphan_customer_return import close_return


def _seed(db: Session, *, with_smartup: bool = True, posted: bool = False):
    admin = User(
        username=f"adm-cret-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    picker = User(
        username=f"pk-cret-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    product = Product(
        external_source="test",
        external_id=f"cret-{uuid.uuid4().hex[:8]}",
        name="Prod",
        sku=f"SKU-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db.add_all([admin, picker, product])
    db.flush()

    cr = CustomerReturn(
        doc_no=f"CRET-TEST-{uuid.uuid4().hex[:6]}",
        customer_name="Test mijoz",
        source="smartup" if with_smartup else "manual",
        status="assigned_to_picker",
        assigned_picker_user_id=picker.id,
    )
    cr.lines.append(
        CustomerReturnLine(
            product_id=product.id,
            product_name="Prod",
            location_code="",
            qty=Decimal("4"),
            batch="b1",
        )
    )
    db.add(cr)
    db.flush()

    sr = None
    if with_smartup:
        sr = SmartupReturn(
            deal_id=f"deal-{uuid.uuid4().hex[:8]}",
            wms_status="dispatched",
            customer_return_id=cr.id,
        )
        db.add(sr)

    if posted:
        lot = StockLot(product_id=product.id, batch="b1", expiry_date=None)
        db.add(lot)
        db.flush()
        # complete bo'lib bo'lgan holatni imitatsiya qilamiz — himoya ishlashi kerak.
        from app.models.location import Location

        loc = Location(
            code=f"S-{uuid.uuid4().hex[:6]}",
            barcode_value=f"S-{uuid.uuid4().hex[:6]}",
            name="Bin",
            type="bin",
            zone_type="NORMAL",
            is_active=True,
        )
        db.add(loc)
        db.flush()
        db.add(
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=loc.id,
                qty_change=Decimal("4"),
                movement_type="receipt",
                source_document_type="customer_return",
                source_document_id=cr.id,
            )
        )
    db.commit()
    return admin, cr, sr


def test_dry_run_changes_nothing(db_session: Session):
    admin, cr, sr = _seed(db_session)

    assert close_return(db_session, cr.doc_no, admin, apply=False) is True

    db_session.expire_all()
    assert cr.status == "assigned_to_picker"
    assert sr.wms_status == "dispatched"
    assert sr.customer_return_id == cr.id


def test_apply_cancels_and_reverts_smartup_link(db_session: Session):
    admin, cr, sr = _seed(db_session)

    assert close_return(db_session, cr.doc_no, admin, apply=True) is True

    db_session.expire_all()
    assert cr.status == "cancelled"
    assert sr.wms_status == "new"
    assert sr.customer_return_id is None
    # Stock harakati yozilmagan.
    moves = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.source_document_type == "customer_return",
            StockMovement.source_document_id == cr.id,
        )
        .count()
    )
    assert moves == 0


def test_manual_return_without_smartup_link(db_session: Session):
    admin, cr, _ = _seed(db_session, with_smartup=False)

    assert close_return(db_session, cr.doc_no, admin, apply=True) is True
    db_session.expire_all()
    assert cr.status == "cancelled"


def test_posted_return_is_protected(db_session: Session):
    """Stock'ka yozilgan qaytim bekor qilinmaydi — himoya."""
    admin, cr, sr = _seed(db_session, posted=True)

    assert close_return(db_session, cr.doc_no, admin, apply=True) is False

    db_session.expire_all()
    assert cr.status == "assigned_to_picker"
    assert sr.wms_status == "dispatched"
