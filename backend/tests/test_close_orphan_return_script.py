"""close_orphan_return_sessions skripti: stock'ka tegmasdan ma'muriy yopish."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.auth.security import get_password_hash
from app.models.document import Document, DocumentLine
from app.models.location import Location
from app.models.order import Order, OrderWmsState
from app.models.product import Product
from app.models.safe_cancel_return import SafeCancelReturnLine, SafeCancelReturnSession
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.services.stock_availability import compute_lot_location_balances
from scripts.close_orphan_return_sessions import close_order


def _seed(db: Session):
    """Bekor qilinayotgan buyurtma: 5 talik qatordan 2 tasi terilgan, sessiya ochiq.

    Stock holati: receipt 10, allocate +5, pick -2 (terilgan qism), unallocate -2.
    Qolgan rezerv = 3 (terilmagan qism) — yopishda aynan shu bo'shatilishi kerak.
    """
    admin = User(
        username=f"adm-orph-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    picker = User(
        username=f"pk-orph-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db.add_all([admin, picker])
    db.flush()

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
        external_id=f"orph-{uuid.uuid4().hex[:8]}",
        name="Prod",
        sku=f"SKU-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db.add_all([loc, product])
    db.flush()
    lot = StockLot(product_id=product.id, batch="B1", expiry_date=None)
    db.add(lot)
    db.flush()

    order = Order(
        source="smartup",
        source_external_id=f"orph-{uuid.uuid4().hex[:10]}",
        order_number=f"9{uuid.uuid4().hex[:5]}",
    )
    order.wms_state = OrderWmsState(status="cancelling_in_progress")
    db.add(order)
    db.flush()
    doc = Document(
        doc_no=f"SO-{uuid.uuid4().hex[:8]}",
        doc_type="SO",
        status="cancelling",
        order_id=order.id,
        assigned_to_user_id=picker.id,
    )
    db.add(doc)
    db.flush()
    dline = DocumentLine(
        document_id=doc.id,
        product_id=product.id,
        lot_id=lot.id,
        location_id=loc.id,
        product_name="Prod",
        location_code=loc.code,
        required_qty=5,
        picked_qty=2,
    )
    db.add(dline)
    db.flush()

    for qty, mtype in ((10, "receipt"), (5, "allocate"), (-2, "pick"), (-2, "unallocate")):
        db.add(
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=loc.id,
                qty_change=Decimal(qty),
                movement_type=mtype,
            )
        )

    session = SafeCancelReturnSession(
        order_id=order.id,
        document_id=doc.id,
        picker_user_id=picker.id,
        initiated_by_user_id=admin.id,
        status="returns_pending",
    )
    db.add(session)
    db.flush()
    db.add(
        SafeCancelReturnLine(
            session_id=session.id,
            document_line_id=dline.id,
            expected_location_id=loc.id,
            expected_location_code=loc.code,
            product_id=product.id,
            lot_id=lot.id,
            product_name="Prod",
            qty_to_return=2,
            product_confirmed=True,
        )
    )
    db.commit()
    return admin, order, doc, session, lot, loc


def test_dry_run_changes_nothing(db_session: Session):
    admin, order, doc, session, lot, loc = _seed(db_session)

    assert close_order(db_session, order.order_number, admin, apply=False) is True

    db_session.expire_all()
    assert order.wms_state.status == "cancelling_in_progress"
    assert doc.status == "cancelling"
    assert session.status == "returns_pending"
    _oh, reserved, _av = compute_lot_location_balances(db_session, lot.id, loc.id)
    assert reserved == Decimal("3")


def test_apply_closes_everything_without_touching_stock(db_session: Session):
    admin, order, doc, session, lot, loc = _seed(db_session)
    on_hand_before, _r, _a = compute_lot_location_balances(db_session, lot.id, loc.id)

    assert close_order(db_session, order.order_number, admin, apply=True) is True

    db_session.expire_all()
    assert session.status == "completed"
    assert session.completed_at is not None
    assert doc.status == "cancelled"
    assert order.wms_state.status == "cancelled"
    assert order.wms_state.cancelled_at is not None

    on_hand, reserved, _av = compute_lot_location_balances(db_session, lot.id, loc.id)
    # Fizik qoldiq o'zgarmagan (qaytarish harakatlari yozilmagan).
    assert on_hand == on_hand_before == Decimal("8")
    # Qolgan rezerv (5-2=3) bo'shatilgan.
    assert reserved == Decimal("0")
    # Terilgan miqdor tarixda qolgan.
    dline = db_session.query(DocumentLine).filter(DocumentLine.document_id == doc.id).one()
    assert dline.picked_qty == 2


def test_wrong_status_is_skipped(db_session: Session):
    admin, order, doc, session, lot, loc = _seed(db_session)
    order.wms_state.status = "cancelled"  # allaqachon yopilgan
    db_session.commit()

    assert close_order(db_session, order.order_number, admin, apply=True) is False

    db_session.expire_all()
    assert session.status == "returns_pending"  # tegilmagan
    _oh, reserved, _av = compute_lot_location_balances(db_session, lot.id, loc.id)
    assert reserved == Decimal("3")
