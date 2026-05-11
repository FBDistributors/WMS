"""GET /picking/documents wms_group filter and order_id on list items."""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.document import Document, DocumentLine
from app.models.order import Order, OrderWmsState
from app.models.user import User


def _admin(db: Session) -> User:
    u = User(
        username=f"wmsgrp-adm-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _order_with_wms(db: Session, *, wms: str, suffix: str) -> Order:
    o = Order(
        source="test",
        source_external_id=f"wmsgrp-{suffix}-{uuid.uuid4().hex[:10]}",
        order_number=f"ORD-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    o.wms_state = OrderWmsState(status=wms)
    db.add(o)
    db.flush()
    return o


def _so_doc(db: Session, *, doc_no: str, order_id, doc_status: str) -> Document:
    d = Document(
        doc_no=doc_no,
        doc_type="SO",
        status=doc_status,
        order_id=order_id,
    )
    db.add(d)
    db.flush()
    db.add(
        DocumentLine(
            document_id=d.id,
            product_name="P",
            location_code="L1",
            required_qty=1.0,
            picked_qty=0.0 if doc_status != "picked" else 1.0,
        )
    )
    db.commit()
    db.refresh(d)
    return d


def test_list_picking_documents_wms_group_yigishda(client: TestClient, db_session: Session) -> None:
    admin = _admin(db_session)
    o_alloc = _order_with_wms(db_session, wms="allocated", suffix="a")
    o_pick = _order_with_wms(db_session, wms="picked", suffix="p")
    d_y = _so_doc(db_session, doc_no=f"SO-Y-{uuid.uuid4().hex[:6]}", order_id=o_alloc.id, doc_status="in_progress")
    d_t = _so_doc(db_session, doc_no=f"SO-T-{uuid.uuid4().hex[:6]}", order_id=o_pick.id, doc_status="picked")

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        r = client.get(
            "/api/v1/picking/documents",
            params={"process_scope": "active", "wms_group": "yigishda", "limit": 200, "offset": 0},
        )
        assert r.status_code == 200, r.text
        rows = r.json()
        ids = {uuid.UUID(x["id"]) for x in rows}
        assert d_y.id in ids
        assert d_t.id not in ids
        row_y = next(x for x in rows if x["id"] == str(d_y.id))
        assert row_y.get("order_wms_status") == "allocated"
        assert row_y.get("order_id") == str(o_alloc.id)
    finally:
        app.dependency_overrides.clear()


def test_list_picking_documents_wms_group_tekshiruvda(client: TestClient, db_session: Session) -> None:
    admin = _admin(db_session)
    o_alloc = _order_with_wms(db_session, wms="allocated", suffix="a2")
    o_pick = _order_with_wms(db_session, wms="picked", suffix="p2")
    _so_doc(db_session, doc_no=f"SO-Y2-{uuid.uuid4().hex[:6]}", order_id=o_alloc.id, doc_status="in_progress")
    d_t = _so_doc(db_session, doc_no=f"SO-T2-{uuid.uuid4().hex[:6]}", order_id=o_pick.id, doc_status="picked")

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        r = client.get(
            "/api/v1/picking/documents",
            params={"process_scope": "active", "wms_group": "tekshiruvda", "limit": 200, "offset": 0},
        )
        assert r.status_code == 200, r.text
        ids = {uuid.UUID(x["id"]) for x in r.json()}
        assert d_t.id in ids
        assert all(x.get("order_wms_status") == "picked" for x in r.json() if x["id"] == str(d_t.id))
    finally:
        app.dependency_overrides.clear()


def test_wms_group_ignored_for_picker(client: TestClient, db_session: Session) -> None:
    picker = User(
        username=f"wmsgrp-pk-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db_session.add(picker)
    db_session.flush()
    o_alloc = _order_with_wms(db_session, wms="allocated", suffix="pk")
    o_pick = _order_with_wms(db_session, wms="picked", suffix="pk2")
    d1 = _so_doc(db_session, doc_no=f"SO-P1-{uuid.uuid4().hex[:6]}", order_id=o_alloc.id, doc_status="in_progress")
    d1.assigned_to_user_id = picker.id
    d2 = _so_doc(db_session, doc_no=f"SO-P2-{uuid.uuid4().hex[:6]}", order_id=o_pick.id, doc_status="picked")
    d2.assigned_to_user_id = picker.id
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        r = client.get(
            "/api/v1/picking/documents",
            params={"process_scope": "active", "wms_group": "yigishda", "limit": 200, "offset": 0},
        )
        assert r.status_code == 200, r.text
        ids = {uuid.UUID(x["id"]) for x in r.json()}
        assert d1.id in ids
        assert d2.id in ids
    finally:
        app.dependency_overrides.clear()
