"""action_margins (chegirmali mahsulot qatori) EXPIRED zonadan terilishi.

Oddiy mahsulot qatori (line_source="product") odatda faqat NORMAL zonadan va
muddat poli bilan teriladi. Agar SmartUp deal qatorida `action_margins` bo'lsa
(chegirma/aksiya), qator promo kabi avval EXPIRED zonadan terilishi kerak.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.document import Document, DocumentLine
from app.models.location import Location
from app.models.order import OrderLine
from app.models.product import Product
from app.models.stock import StockLot, StockMovement

from tests.test_validate_send_to_picking import (
    _mk_admin,
    _mk_picker,
    _order_imported,
)


def _seed_product_with_expired_zone_stock(
    db: Session, *, sku: str, qty: Decimal
) -> tuple[Product, Location]:
    """Mahsulotni faqat EXPIRED zonadagi joyga (muddati o'tgan lot) joylaydi."""
    product = Product(
        external_source="test",
        external_id=f"prod-{uuid.uuid4().hex[:8]}",
        name="Margin Product",
        sku=sku,
        is_active=True,
    )
    db.add(product)
    db.flush()
    loc = Location(
        code=f"EXP-{uuid.uuid4().hex[:6]}",
        barcode_value=f"EXP-{uuid.uuid4().hex[:6]}",
        name="Expired bin",
        type="bin",
        zone_type="EXPIRED",
        is_active=True,
    )
    db.add(loc)
    db.flush()
    lot = StockLot(product_id=product.id, batch="EXP-B1", expiry_date=None)
    db.add(lot)
    db.flush()
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=qty,
            movement_type="receipt",
        )
    )
    db.commit()
    db.refresh(product)
    db.refresh(loc)
    return product, loc


def _send_to_picking(client: TestClient, admin, picker, order):
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        return client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_action_margin_line_allocates_from_expired_zone(
    client: TestClient, db_session: Session
) -> None:
    admin = _mk_admin(db_session)
    picker = _mk_picker(db_session)
    product, exp_loc = _seed_product_with_expired_zone_stock(
        db_session, sku=f"SKU-AM-{uuid.uuid4().hex[:6]}", qty=Decimal("20")
    )

    order = _order_imported(
        db_session,
        lines=[
            OrderLine(
                sku=product.sku,
                name="Chegirmali mahsulot",
                qty=3.0,
                uom="dona",
                line_source="product",
                raw_json={
                    "action_margins": [
                        {"margin_value": "-50", "margin_kind": "P", "action_name": "Test"}
                    ]
                },
            )
        ],
    )

    res = _send_to_picking(client, admin, picker, order)
    assert res.status_code == 200

    doc_id = uuid.UUID(res.json()["pick_task_id"])
    lines = (
        db_session.query(DocumentLine)
        .join(Document, DocumentLine.document_id == Document.id)
        .filter(Document.id == doc_id)
        .all()
    )
    real = [ln for ln in lines if not ln.is_vip_expiry_informational]
    assert len(real) == 1
    assert real[0].location_id == exp_loc.id
    assert float(real[0].required_qty) == 3.0


def test_plain_line_without_margin_does_not_allocate_from_expired(
    client: TestClient, db_session: Session
) -> None:
    """Chegirmasiz oddiy qator EXPIRED zonadan terilmaydi → yetishmovchilik (409)."""
    admin = _mk_admin(db_session)
    picker = _mk_picker(db_session)
    product, _ = _seed_product_with_expired_zone_stock(
        db_session, sku=f"SKU-PL-{uuid.uuid4().hex[:6]}", qty=Decimal("20")
    )

    order = _order_imported(
        db_session,
        lines=[
            OrderLine(
                sku=product.sku,
                name="Oddiy mahsulot",
                qty=3.0,
                uom="dona",
                line_source="product",
            )
        ],
    )

    res = _send_to_picking(client, admin, picker, order)
    assert res.status_code == 409
    detail = res.json().get("detail")
    assert isinstance(detail, dict)
    assert detail.get("code") == "INSUFFICIENT_STOCK"
