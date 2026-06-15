"""Buyurtma ajratish va terish: showroom omboridan chiqarish."""
from __future__ import annotations

import uuid
from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.document import Document, DocumentLine
from app.models.location import Location
from app.models.order import Order, OrderLine, OrderWmsState
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.api.v1.endpoints.orders import _fefo_available_lots


def _mk_user(db: Session, *, username: str, role: str) -> User:
    user = User(
        username=username,
        password_hash=get_password_hash("testpass123"),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _seed_main_and_showroom_stock(
    db: Session,
    *,
    main_qty: Decimal,
    showroom_qty: Decimal,
) -> tuple[Product, Location, Location, StockLot, User]:
    _mk_user(db, username=f"adm-wh-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    picker = _mk_user(db, username=f"pick-wh-{uuid.uuid4().hex[:8]}", role="picker")

    showroom_root = Location(
        code="SHOWROOM",
        barcode_value="SHOWROOM",
        name="Showroom Root",
        type="warehouse",
        is_active=True,
    )
    db.add(showroom_root)
    db.flush()

    product = Product(
        external_source="test",
        external_id=f"ext-wh-{uuid.uuid4()}",
        name="Warehouse Scope Product",
        sku=f"SKU-WH-{uuid.uuid4().hex[:8]}",
        barcode=f"BC-WH-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db.add(product)
    db.flush()

    main_bin = Location(
        code=f"M-{uuid.uuid4().hex[:6]}",
        barcode_value=f"M-{uuid.uuid4().hex[:6]}",
        name="Main bin",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    showroom_bin = Location(
        code=f"S-01-{uuid.uuid4().hex[:2]}",
        barcode_value=f"S-01-{uuid.uuid4().hex[:2]}",
        name="Showroom rack",
        type="showroom_rack",
        zone_type="NORMAL",
        is_active=True,
        warehouse_id=showroom_root.id,
    )
    db.add_all([main_bin, showroom_bin])
    db.flush()

    lot = StockLot(product_id=product.id, batch="WH-B1", expiry_date=None)
    db.add(lot)
    db.flush()

    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=main_bin.id,
            qty_change=main_qty,
            movement_type="receipt",
        )
    )
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=showroom_bin.id,
            qty_change=showroom_qty,
            movement_type="receipt",
        )
    )
    db.commit()
    db.refresh(product)
    db.refresh(main_bin)
    db.refresh(showroom_bin)
    db.refresh(lot)
    return product, main_bin, showroom_bin, lot, picker


def test_fefo_available_lots_respects_location_ids(db_session: Session) -> None:
    product, main_bin, showroom_bin, _lot, _picker = _seed_main_and_showroom_stock(
        db_session,
        main_qty=Decimal("5"),
        showroom_qty=Decimal("20"),
    )

    main_rows = _fefo_available_lots(
        db_session,
        product.id,
        location_ids=[main_bin.id],
    )
    assert len(main_rows) == 1
    assert main_rows[0].location_id == main_bin.id
    assert float(main_rows[0].qty) == 5.0

    showroom_rows = _fefo_available_lots(
        db_session,
        product.id,
        location_ids=[showroom_bin.id],
    )
    assert len(showroom_rows) == 1
    assert showroom_rows[0].location_id == showroom_bin.id


def test_allocate_prefers_main_over_showroom(
    client: TestClient,
    db_session: Session,
) -> None:
    product, main_bin, showroom_bin, _lot, picker = _seed_main_and_showroom_stock(
        db_session,
        main_qty=Decimal("5"),
        showroom_qty=Decimal("20"),
    )
    admin = _mk_user(db_session, username=f"adm-alloc-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    order = Order(
        source="test",
        source_external_id=f"order-wh-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-WH-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = [
        OrderLine(
            sku=product.sku,
            name="WH line",
            qty=3.0,
            uom="dona",
        )
    ]
    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            f"/api/v1/orders/{order.id}/send-to-picking",
            json={"assigned_to_user_id": str(picker.id)},
        )
        assert res.status_code == 200, res.text
        doc_id = UUID(res.json()["pick_task_id"])
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert doc.status_code == 200, doc.text
    lines = doc.json()["lines"]
    assert len(lines) >= 1
    assert all(
        not (ln.get("location_code") or "").upper().startswith("S-")
        for ln in lines
    )
    assert showroom_bin.id not in {UUID(a["location_id"]) for ln in lines for a in (ln.get("alternate_locations") or []) if a.get("is_primary") and a.get("location_id")}
    assert main_bin.id in {UUID(a["location_id"]) for ln in lines for a in (ln.get("alternate_locations") or []) if a.get("is_primary") and a.get("location_id")}


def test_pick_rejects_showroom_allocated_line(
    client: TestClient,
    db_session: Session,
) -> None:
    product, _main_bin, showroom_bin, lot, picker = _seed_main_and_showroom_stock(
        db_session,
        main_qty=Decimal("0"),
        showroom_qty=Decimal("10"),
    )

    order = Order(
        source="test",
        source_external_id=f"order-sh-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-SH-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="picking")
    db_session.add(order)
    db_session.flush()

    doc = Document(
        doc_no=f"SO-SH-DOC-{uuid.uuid4().hex[:6]}",
        doc_type="SO",
        status="picking",
        order_id=order.id,
        assigned_to_user_id=picker.id,
    )
    db_session.add(doc)
    db_session.flush()

    line = DocumentLine(
        document_id=doc.id,
        product_id=product.id,
        lot_id=lot.id,
        location_id=showroom_bin.id,
        sku=product.sku,
        product_name=product.name,
        barcode=product.barcode,
        location_code=showroom_bin.code,
        batch=lot.batch,
        required_qty=1.0,
        picked_qty=0.0,
    )
    db_session.add(line)
    db_session.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=showroom_bin.id,
            qty_change=Decimal("1"),
            movement_type="allocate",
            source_document_type="order",
            source_document_id=order.id,
        )
    )
    db_session.commit()
    db_session.refresh(line)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        pick = client.post(
            f"/api/v1/picking/lines/{line.id}/pick",
            json={
                "delta": 1,
                "request_id": f"pick-sh-{uuid.uuid4().hex}",
                "barcode": product.barcode,
            },
        )
        assert pick.status_code == 400
        assert "Showroom" in pick.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
