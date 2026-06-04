"""Promo/gift line_source flows from order_lines to document_lines and picking API."""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.document import Document, DocumentLine
from app.models.order import Order, OrderLine, OrderWmsState
from tests.test_validate_send_to_picking import (
    _mk_admin,
    _mk_picker,
    _order_imported,
    _seed_product_with_stock,
)


def test_send_to_picking_preserves_line_source_on_document_and_api(
    client: TestClient, db_session: Session
) -> None:
    admin = _mk_admin(db_session)
    picker = _mk_picker(db_session)
    product = _seed_product_with_stock(
        db_session, sku=f"SKU-PROMO-{uuid.uuid4().hex[:6]}", qty=Decimal("50")
    )

    order = _order_imported(
        db_session,
        lines=[
            OrderLine(
                sku=product.sku,
                name="Paid",
                qty=2.0,
                uom="dona",
                line_source="product",
            ),
            OrderLine(
                sku=product.sku,
                name="Promo",
                qty=1.0,
                uom="dona",
                line_source="action",
            ),
        ],
    )

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        send = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert send.status_code == 200
    doc_id = uuid.UUID(send.json()["pick_task_id"])

    doc_lines = (
        db_session.query(DocumentLine)
        .join(Document, DocumentLine.document_id == Document.id)
        .filter(Document.id == doc_id)
        .all()
    )
    db_sources = {(ln.line_source or "product") for ln in doc_lines if not ln.is_vip_expiry_informational}
    assert "product" in db_sources
    assert "action" in db_sources

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        res = client.get(f"/api/v1/picking/documents/{doc_id!s}")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert res.status_code == 200
    api_lines = res.json().get("lines") or []
    api_sources = {
        (ln.get("line_source") or "product")
        for ln in api_lines
        if not ln.get("is_vip_expiry_informational")
    }
    assert "product" in api_sources
    assert "action" in api_sources
