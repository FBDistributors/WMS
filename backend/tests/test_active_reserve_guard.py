"""active_reserved_pairs: qoldiq nollash himoyasi uchun faol rezerv juftliklari."""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models.document import Document, DocumentLine
from app.models.location import Location
from app.models.order import Order, OrderWmsState
from app.models.product import Product
from app.models.stock import StockLot
from app.services.active_reserve_guard import active_reserved_pairs


def _mk_location(db: Session) -> Location:
    loc = Location(
        code=f"S-{uuid.uuid4().hex[:6]}",
        barcode_value=f"S-{uuid.uuid4().hex[:6]}",
        name="Src",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    db.add(loc)
    db.flush()
    return loc


def _mk_lot(db: Session) -> StockLot:
    product = Product(
        external_source="test",
        external_id=f"ext-{uuid.uuid4().hex[:8]}",
        name="Prod",
        sku=f"SKU-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db.add(product)
    db.flush()
    lot = StockLot(product_id=product.id, batch=f"B{uuid.uuid4().hex[:4]}", expiry_date=None)
    db.add(lot)
    db.flush()
    return lot


def _mk_doc(
    db: Session,
    *,
    status: str = "in_progress",
    order_number: str | None = None,
) -> Document:
    doc = Document(
        doc_no=f"SO-{uuid.uuid4().hex[:8]}",
        doc_type="SO",
        status=status,
    )
    if order_number:
        order = Order(
            source="test",
            source_external_id=f"ord-{uuid.uuid4().hex[:10]}",
            order_number=order_number,
        )
        order.wms_state = OrderWmsState(status="allocated")
        db.add(order)
        db.flush()
        doc.order_id = order.id
    db.add(doc)
    db.flush()
    return doc


def _mk_line(
    db: Session,
    doc: Document,
    lot: StockLot,
    loc: Location,
    *,
    required: float = 3,
    picked: float = 0,
    skip_reason: str | None = None,
    vip_informational: bool = False,
) -> DocumentLine:
    line = DocumentLine(
        document_id=doc.id,
        product_id=lot.product_id,
        lot_id=lot.id,
        location_id=loc.id,
        product_name="Prod",
        location_code=loc.code,
        required_qty=required,
        picked_qty=picked,
        skip_reason=skip_reason,
        is_vip_expiry_informational=vip_informational,
    )
    db.add(line)
    db.flush()
    return line


def test_active_line_marks_pair_with_order_number(db_session: Session):
    lot, loc = _mk_lot(db_session), _mk_location(db_session)
    doc = _mk_doc(db_session, status="in_progress", order_number="104938")
    _mk_line(db_session, doc, lot, loc, required=3, picked=0)

    result = active_reserved_pairs(db_session)

    assert result == {(lot.id, loc.id): ["104938"]}


def test_doc_no_used_when_order_missing(db_session: Session):
    lot, loc = _mk_lot(db_session), _mk_location(db_session)
    doc = _mk_doc(db_session, status="draft", order_number=None)
    _mk_line(db_session, doc, lot, loc)

    result = active_reserved_pairs(db_session)

    assert result == {(lot.id, loc.id): [doc.doc_no]}


def test_completed_and_cancelled_docs_are_not_active(db_session: Session):
    lot, loc = _mk_lot(db_session), _mk_location(db_session)
    for status in ("completed", "cancelled", "packed", "shipped"):
        doc = _mk_doc(db_session, status=status, order_number=f"9{status[:3]}")
        _mk_line(db_session, doc, lot, loc)

    assert active_reserved_pairs(db_session) == {}


def test_fully_picked_skipped_and_vip_lines_are_not_active(db_session: Session):
    lot, loc = _mk_lot(db_session), _mk_location(db_session)
    doc = _mk_doc(db_session, status="in_progress", order_number="104950")
    _mk_line(db_session, doc, lot, loc, required=3, picked=3)  # terib bo'lingan
    _mk_line(db_session, doc, lot, loc, skip_reason="no_stock")  # skip qilingan
    _mk_line(db_session, doc, lot, loc, vip_informational=True)  # VIP-informatsion

    assert active_reserved_pairs(db_session) == {}


def test_pairs_filter_restricts_result(db_session: Session):
    lot_a, loc_a = _mk_lot(db_session), _mk_location(db_session)
    lot_b, loc_b = _mk_lot(db_session), _mk_location(db_session)
    doc = _mk_doc(db_session, status="in_progress", order_number="104960")
    _mk_line(db_session, doc, lot_a, loc_a)
    _mk_line(db_session, doc, lot_b, loc_b)

    result = active_reserved_pairs(db_session, pairs=[(lot_a.id, loc_a.id)])

    assert set(result) == {(lot_a.id, loc_a.id)}


def test_two_orders_same_pair_both_reported(db_session: Session):
    lot, loc = _mk_lot(db_session), _mk_location(db_session)
    doc1 = _mk_doc(db_session, status="in_progress", order_number="104970")
    doc2 = _mk_doc(db_session, status="picked", order_number="104971")
    _mk_line(db_session, doc1, lot, loc)
    _mk_line(db_session, doc2, lot, loc)

    result = active_reserved_pairs(db_session)

    assert result == {(lot.id, loc.id): ["104970", "104971"]}
