"""Terish tartibi: urgency bucket, pick_sequence (code alfaviti emas), FEFO, id."""
import uuid
from datetime import date

import pytest

from app.api.v1.endpoints import picking as picking_mod
from app.models.document import Document, DocumentLine
from app.models.location import Location


@pytest.fixture
def _fixed_urgency_cutoff(monkeypatch):
    """Muddat <= 2026-04-10 'yaqin' guruhi."""
    monkeypatch.setattr(
        picking_mod,
        "_picking_urgency_cutoff_today",
        lambda: date(2026, 4, 10),
    )


def test_picking_route_order_urgent_before_pick_sequence(db_session, _fixed_urgency_cutoff):
    """Yaqin muddatli qator avval, hatto pick_sequence yomon bo‘lsa ham (kod alifboga qarab emas)."""
    doc = Document(doc_no="SO-ORD-1", doc_type="SO", status="draft")
    db_session.add(doc)
    loc_far = Location(
        code="ZZ-99-99-99",
        barcode_value="ZZ-99-99-99",
        name="Z last alpha",
        type="bin",
        pick_sequence=5,
        zone_type="NORMAL",
    )
    loc_urgent = Location(
        code="AA-01-01-01",
        barcode_value="AA-01-01-01",
        name="A first alpha",
        type="bin",
        pick_sequence=500,
        zone_type="NORMAL",
    )
    db_session.add_all([loc_far, loc_urgent])
    db_session.commit()
    db_session.refresh(doc)
    db_session.refresh(loc_far)
    db_session.refresh(loc_urgent)

    line_far = DocumentLine(
        document_id=doc.id,
        product_name="P",
        location_id=loc_far.id,
        location_code=loc_far.code,
        expiry_date=date(2026, 6, 1),
        required_qty=1.0,
    )
    line_urgent = DocumentLine(
        document_id=doc.id,
        product_name="P",
        location_id=loc_urgent.id,
        location_code=loc_urgent.code,
        expiry_date=date(2026, 4, 5),
        required_qty=1.0,
    )
    db_session.add_all([line_far, line_urgent])
    db_session.commit()

    rows = (
        db_session.query(DocumentLine)
        .outerjoin(Location, DocumentLine.location_id == Location.id)
        .filter(DocumentLine.document_id == doc.id)
        .order_by(*picking_mod._picking_route_order_by(urgency_cutoff_date=date(2026, 4, 10)))
        .all()
    )
    assert [r.id for r in rows] == [line_urgent.id, line_far.id]


def test_picking_route_order_pick_sequence_not_alphabetical_code(db_session, _fixed_urgency_cutoff):
    """Ikkalasi ham 'yaqin emas' bo‘lsa tartib pick_sequence; kod ZZ AA dan oldin emas."""
    doc = Document(doc_no="SO-ORD-2", doc_type="SO", status="draft")
    db_session.add(doc)
    loc_late_alpha_early_seq = Location(
        code="ZZ-LOW-SEQ",
        barcode_value="ZZ-LOW-SEQ",
        name="Z",
        type="bin",
        pick_sequence=5,
        zone_type="NORMAL",
    )
    loc_early_alpha_late_seq = Location(
        code="AA-HIGH-SEQ",
        barcode_value="AA-HIGH-SEQ",
        name="A",
        type="bin",
        pick_sequence=100,
        zone_type="NORMAL",
    )
    db_session.add_all([loc_late_alpha_early_seq, loc_early_alpha_late_seq])
    db_session.commit()
    db_session.refresh(doc)
    db_session.refresh(loc_late_alpha_early_seq)
    db_session.refresh(loc_early_alpha_late_seq)

    line_z = DocumentLine(
        document_id=doc.id,
        product_name="P",
        location_id=loc_late_alpha_early_seq.id,
        location_code=loc_late_alpha_early_seq.code,
        expiry_date=date(2026, 12, 31),
        required_qty=1.0,
    )
    line_a = DocumentLine(
        document_id=doc.id,
        product_name="P",
        location_id=loc_early_alpha_late_seq.id,
        location_code=loc_early_alpha_late_seq.code,
        expiry_date=date(2026, 12, 31),
        required_qty=1.0,
    )
    db_session.add_all([line_z, line_a])
    db_session.commit()

    rows = (
        db_session.query(DocumentLine)
        .outerjoin(Location, DocumentLine.location_id == Location.id)
        .filter(DocumentLine.document_id == doc.id)
        .order_by(*picking_mod._picking_route_order_by(urgency_cutoff_date=date(2026, 4, 10)))
        .all()
    )
    assert [r.id for r in rows] == [line_z.id, line_a.id]


def test_picking_route_order_same_pick_sequence_fefo(db_session, _fixed_urgency_cutoff):
    """Bir xil pick_sequence: FEFO (expiry), keyin id."""
    doc = Document(doc_no="SO-ORD-3", doc_type="SO", status="draft")
    db_session.add(doc)
    loc = Location(
        code="S-01-01-01",
        barcode_value="S-01-01-01",
        name="Same",
        type="bin",
        pick_sequence=10,
        zone_type="NORMAL",
    )
    db_session.add(loc)
    db_session.commit()
    db_session.refresh(doc)
    db_session.refresh(loc)

    later_id = uuid.uuid4()
    earlier_id = uuid.uuid4()
    line_later_exp = DocumentLine(
        id=later_id,
        document_id=doc.id,
        product_name="P",
        location_id=loc.id,
        location_code=loc.code,
        expiry_date=date(2026, 8, 1),
        required_qty=1.0,
    )
    line_earlier_exp = DocumentLine(
        id=earlier_id,
        document_id=doc.id,
        product_name="P",
        location_id=loc.id,
        location_code=loc.code,
        expiry_date=date(2026, 7, 1),
        required_qty=1.0,
    )
    db_session.add_all([line_later_exp, line_earlier_exp])
    db_session.commit()

    rows = (
        db_session.query(DocumentLine)
        .outerjoin(Location, DocumentLine.location_id == Location.id)
        .filter(DocumentLine.document_id == doc.id)
        .order_by(*picking_mod._picking_route_order_by(urgency_cutoff_date=date(2026, 4, 10)))
        .all()
    )
    assert [r.id for r in rows] == [line_earlier_exp.id, line_later_exp.id]


def test_null_expiry_not_in_urgent_bucket(db_session, _fixed_urgency_cutoff):
    """NULL muddat — bucket 1; yaqin muddatli qator oldinda."""
    doc = Document(doc_no="SO-ORD-4", doc_type="SO", status="draft")
    db_session.add(doc)
    loc = Location(
        code="S-02-02-02",
        barcode_value="S-02-02-02",
        name="L",
        type="bin",
        pick_sequence=1,
        zone_type="NORMAL",
    )
    db_session.add(loc)
    db_session.commit()
    db_session.refresh(doc)
    db_session.refresh(loc)

    line_null = DocumentLine(
        document_id=doc.id,
        product_name="P",
        location_id=loc.id,
        location_code=loc.code,
        expiry_date=None,
        required_qty=1.0,
    )
    line_urgent = DocumentLine(
        document_id=doc.id,
        product_name="P",
        location_id=loc.id,
        location_code=loc.code,
        expiry_date=date(2026, 4, 9),
        required_qty=1.0,
    )
    db_session.add_all([line_null, line_urgent])
    db_session.commit()

    rows = (
        db_session.query(DocumentLine)
        .outerjoin(Location, DocumentLine.location_id == Location.id)
        .filter(DocumentLine.document_id == doc.id)
        .order_by(*picking_mod._picking_route_order_by(urgency_cutoff_date=date(2026, 4, 10)))
        .all()
    )
    assert rows[0].id == line_urgent.id
