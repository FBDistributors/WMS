"""Controller ro'yxatida buyurtma manbasi guruhi: shahar / region.

Har bir hujjat aynan bitta guruhga tushishi kerak — aks holda ilovadagi tablardan
birortasida ham ko'rinmay qolardi.
"""
from __future__ import annotations

import uuid

import pytest

from app.api.v1.endpoints.picking import _to_picking_list_item
from app.models.document import Document
from app.models.order import Order, OrderWmsState
from app.services.order_source_group import (
    SOURCE_GROUP_CITY,
    SOURCE_GROUP_REGION,
    order_source_group,
)


def _order(db_session, source: str) -> Order:
    order = Order(
        source=source,
        source_external_id=f"src-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-SRC-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="picked")
    db_session.add(order)
    db_session.flush()
    return order


def _document(db_session, order: Order | None) -> Document:
    doc = Document(
        doc_no=f"SO-{uuid.uuid4().hex[:8]}",
        doc_type="SO",
        status="picked",
        order_id=order.id if order else None,
    )
    db_session.add(doc)
    db_session.flush()
    db_session.refresh(doc)
    return doc


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("smartup", SOURCE_GROUP_CITY),
        ("orikzor", SOURCE_GROUP_CITY),
        ("diller", SOURCE_GROUP_REGION),
        # Noma'lum manba ham ko'rinib turishi kerak — shaharga tushadi.
        ("manual", SOURCE_GROUP_CITY),
    ],
)
def test_list_item_source_group(db_session, source: str, expected: str) -> None:
    order = _order(db_session, source)
    doc = _document(db_session, order)

    item = _to_picking_list_item(doc)

    assert item.order_source == source
    assert item.source_group == expected


def test_document_without_order_is_city(db_session) -> None:
    doc = _document(db_session, None)

    item = _to_picking_list_item(doc)

    assert item.order_source is None
    assert item.source_group == SOURCE_GROUP_CITY


def test_partition_conditions_cover_every_document(db_session) -> None:
    """`partition=True` da ikki guruh barcha hujjatlarni qoldiqsiz bo'ladi."""
    from app.services.order_source_group import source_group_conditions

    for source in ("smartup", "orikzor", "diller", "manual"):
        _document(db_session, _order(db_session, source))
    _document(db_session, None)
    db_session.commit()

    def _ids(group: str) -> set:
        return {
            row[0]
            for row in db_session.query(Document.id)
            .outerjoin(Order, Document.order_id == Order.id)
            .filter(*source_group_conditions(group, partition=True))
            .all()
        }

    city = _ids(SOURCE_GROUP_CITY)
    region = _ids(SOURCE_GROUP_REGION)
    all_ids = {row[0] for row in db_session.query(Document.id).all()}

    assert city & region == set(), "hujjat ikkala guruhda turmasligi kerak"
    assert city | region == all_ids, "har bir hujjat bitta guruhga tushishi kerak"


def test_order_source_group_is_case_insensitive() -> None:
    class _FakeOrder:
        source = "Diller"

    assert order_source_group(_FakeOrder()) == SOURCE_GROUP_REGION
    assert order_source_group(None) == SOURCE_GROUP_CITY
