"""POST /picking/documents/{id}/cancel is disabled for picker clients."""
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


def _picker(db: Session) -> User:
    u = User(
        username=f"pk-cancel-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _doc_assigned_to(db: Session, picker_id) -> Document:
    o = Order(
        source="test",
        source_external_id=f"cncl-{uuid.uuid4().hex[:10]}",
        order_number=f"ORD-CN-{uuid.uuid4().hex[:6]}",
    )
    o.wms_state = OrderWmsState(status="allocated")
    db.add(o)
    db.flush()
    d = Document(
        doc_no=f"SO-CN-{uuid.uuid4().hex[:6]}",
        doc_type="SO",
        status="in_progress",
        order_id=o.id,
        assigned_to_user_id=picker_id,
    )
    db.add(d)
    db.flush()
    db.add(
        DocumentLine(
            document_id=d.id,
            product_name="P",
            location_code="L1",
            required_qty=1.0,
            picked_qty=0.0,
        )
    )
    db.commit()
    db.refresh(d)
    return d


def test_picker_document_cancel_returns_403(client: TestClient, db_session: Session) -> None:
    picker = _picker(db_session)
    doc = _doc_assigned_to(db_session, picker.id)
    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        r = client.post(f"/api/v1/picking/documents/{doc.id}/cancel")
        assert r.status_code == 403, r.text
        detail = (r.json() or {}).get("detail", "")
        assert "disabled" in str(detail).lower()
    finally:
        app.dependency_overrides.clear()
