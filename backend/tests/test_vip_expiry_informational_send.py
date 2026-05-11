"""VIP: fiziki zaxira bor lekin VIP muddatdan past — ma'lumot qatori, yuborish ruxsat; zaxira yo'q — 409."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.core.expiry import first_day_of_current_month, min_expiry_date_from_months
from app.main import app
from app.models.brand import Brand
from app.models.document import Document, DocumentLine
from app.models.location import Location
from app.models.order import Order, OrderLine, OrderWmsState
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.models.vip_customer import VipCustomer
from app.models.vip_customer_brand_limit import VipCustomerBrandLimit


def _mk_admin(db: Session) -> User:
    u = User(
        username=f"adm-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _mk_picker(db: Session) -> User:
    u = User(
        username=f"pick-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_vip_short_expiry_creates_informational_line_and_send_ok(
    client: TestClient, db_session: Session
) -> None:
    admin = _mk_admin(db_session)
    picker = _mk_picker(db_session)
    brand = Brand(code=f"B-{uuid.uuid4().hex[:6]}", name="VIP Brand", is_active=True)
    db_session.add(brand)
    db_session.flush()

    vip = VipCustomer(customer_id="vip-cust-1", customer_name="VIP One")
    db_session.add(vip)
    db_session.flush()
    db_session.add(
        VipCustomerBrandLimit(vip_customer_id=vip.id, brand_id=brand.id, min_expiry_months=12),
    )

    sku = f"SKU-VIP-{uuid.uuid4().hex[:6]}"
    product = Product(
        external_source="test",
        external_id=f"ext-{uuid.uuid4().hex[:8]}",
        name="VIP Prod",
        sku=sku,
        brand_id=brand.id,
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()

    loc = Location(
        code=f"L-{uuid.uuid4().hex[:6]}",
        barcode_value=f"L-{uuid.uuid4().hex[:6]}",
        name="Bin",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    db_session.add(loc)
    db_session.flush()

    min_vip = min_expiry_date_from_months(12)
    floor_m = first_day_of_current_month()
    assert floor_m is not None
    # VIP dan past, lekin joriy oy (first_day) dan oldin emas
    if min_vip.month > 1:
        lot_expiry = date(min_vip.year, min_vip.month - 1, 1)
    else:
        lot_expiry = date(min_vip.year - 1, 12, 1)
    assert lot_expiry < min_vip
    assert lot_expiry >= floor_m

    lot = StockLot(product_id=product.id, batch="B-VIP", expiry_date=lot_expiry)
    db_session.add(lot)
    db_session.flush()
    db_session.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal("20"),
            movement_type="receipt",
        )
    )

    order = Order(
        source="test",
        source_external_id=f"ext-o-{uuid.uuid4().hex[:10]}",
        order_number=f"ON-{uuid.uuid4().hex[:6]}",
        customer_id="vip-cust-1",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = [OrderLine(sku=sku, name="Line", qty=3.0, uom="dona")]
    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert res.status_code == 200
    doc = (
        db_session.query(Document)
        .filter(Document.order_id == order.id, Document.doc_type == "SO")
        .one()
    )
    lines = db_session.query(DocumentLine).filter(DocumentLine.document_id == doc.id).all()
    info_lines = [ln for ln in lines if ln.is_vip_expiry_informational]
    normal = [ln for ln in lines if not ln.is_vip_expiry_informational]
    assert len(info_lines) == 1
    assert info_lines[0].required_qty == 3.0
    assert info_lines[0].lot_id is None
    assert info_lines[0].location_id is None
    assert len(normal) == 0
    alloc_count = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.movement_type == "allocate",
            StockMovement.source_document_type == "order",
            StockMovement.source_document_id == order.id,
        )
        .count()
    )
    assert alloc_count == 0


def test_vip_no_physical_stock_still_409(client: TestClient, db_session: Session) -> None:
    admin = _mk_admin(db_session)
    picker = _mk_picker(db_session)
    brand = Brand(code=f"B2-{uuid.uuid4().hex[:6]}", name="B2", is_active=True)
    db_session.add(brand)
    db_session.flush()
    vip = VipCustomer(customer_id="vip-cust-2", customer_name="V2")
    db_session.add(vip)
    db_session.flush()
    db_session.add(
        VipCustomerBrandLimit(vip_customer_id=vip.id, brand_id=brand.id, min_expiry_months=12),
    )
    sku = f"SKU-NOSTOCK-{uuid.uuid4().hex[:6]}"
    product = Product(
        external_source="test",
        external_id=f"e2-{uuid.uuid4().hex[:8]}",
        name="No stock",
        sku=sku,
        brand_id=brand.id,
        is_active=True,
    )
    db_session.add(product)
    order = Order(
        source="test",
        source_external_id=f"ext-o2-{uuid.uuid4().hex[:10]}",
        order_number=f"O2-{uuid.uuid4().hex[:6]}",
        customer_id="vip-cust-2",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = [OrderLine(sku=sku, name="L", qty=5.0, uom="dona")]
    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert res.status_code == 409
    n_doc = db_session.query(Document).filter(Document.order_id == order.id, Document.doc_type == "SO").count()
    assert n_doc == 0
