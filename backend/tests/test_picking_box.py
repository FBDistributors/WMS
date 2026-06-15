"""Document picking: quti bo'yicha terish (box_count, breakdown)."""
from __future__ import annotations

import uuid
from decimal import Decimal
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.document import Document as DocumentModel
from app.models.location import Location as LocationModel
from app.models.order import Order, OrderLine, OrderWmsState
from app.models.product import Product as ProductModel
from app.models.product_box import ProductBox as ProductBoxModel
from app.models.stock import StockLot, StockMovement
from app.models.user import User as UserModel
from app.auth.security import get_password_hash
from app.services.box_location_service import get_breakdown, get_breakdown_for_pick, place_sealed_boxes


def _mk_user(db: Session, *, username: str, role: str) -> UserModel:
    user = UserModel(
        username=username,
        password_hash=get_password_hash("testpass123"),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _seed_box_pick_order(
    db: Session,
    *,
    order_qty: int = 18,
    stock_qty: int = 30,
    box_count: int = 5,
) -> tuple[Order, UserModel, ProductModel, LocationModel, StockLot, str]:
    picker = _mk_user(db, username=f"picker-box-{uuid.uuid4().hex[:8]}", role="picker")
    product = ProductModel(
        external_source="test",
        external_id=f"ext-{uuid.uuid4()}",
        name="Box Pick Product",
        sku=f"SKU-BP-{uuid.uuid4().hex[:8]}",
        barcode=f"BP{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db.add(product)
    db.flush()

    loc = LocationModel(
        code=f"BP-{uuid.uuid4().hex[:6]}",
        barcode_value=f"BP-{uuid.uuid4().hex[:6]}",
        name="Box pick bin",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    db.add(loc)
    db.flush()

    lot = StockLot(product_id=product.id, batch="BP-B1", expiry_date=None)
    db.add(lot)
    db.flush()
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal(str(stock_qty)),
            movement_type="receipt",
        )
    )

    box_barcode = f"BOX-BP-{uuid.uuid4().hex[:6]}"
    box = ProductBoxModel(
        box_barcode=box_barcode,
        product_id=product.id,
        units_per_box=6,
        is_active=True,
    )
    db.add(box)
    db.flush()

    inv = _mk_user(db, username=f"inv-box-{uuid.uuid4().hex[:8]}", role="inventory_controller")
    place_sealed_boxes(
        db,
        box_barcode=box_barcode,
        location_id=loc.id,
        lot_id=lot.id,
        user=inv,
        box_count=box_count,
    )

    order = Order(
        source="test",
        source_external_id=f"order-bp-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-BP-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = [
        OrderLine(
            sku=product.sku,
            name="Box pick line",
            qty=float(order_qty),
            uom="dona",
        )
    ]
    db.add(order)
    db.commit()
    db.refresh(order)
    return order, picker, product, loc, lot, box_barcode


def _seed_loose_pick_order(
    db: Session,
    *,
    order_qty: int = 4,
    stock_qty: int = 4,
) -> tuple[Order, UserModel, ProductModel, LocationModel, StockLot]:
    picker = _mk_user(db, username=f"picker-loose-{uuid.uuid4().hex[:8]}", role="picker")
    product = ProductModel(
        external_source="test",
        external_id=f"ext-{uuid.uuid4()}",
        name="Loose Pick Product",
        sku=f"SKU-LP-{uuid.uuid4().hex[:8]}",
        barcode=f"LP{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db.add(product)
    db.flush()

    loc = LocationModel(
        code=f"LP-{uuid.uuid4().hex[:6]}",
        barcode_value=f"LP-{uuid.uuid4().hex[:6]}",
        name="Loose pick bin",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    db.add(loc)
    db.flush()

    lot = StockLot(product_id=product.id, batch="LP-B1", expiry_date=None)
    db.add(lot)
    db.flush()
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal(str(stock_qty)),
            movement_type="receipt",
        )
    )

    order = Order(
        source="test",
        source_external_id=f"order-lp-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-LP-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = [
        OrderLine(
            sku=product.sku,
            name="Loose pick line",
            qty=float(order_qty),
            uom="dona",
        )
    ]
    db.add(order)
    db.commit()
    db.refresh(order)
    return order, picker, product, loc, lot


def _send_to_picking(client: TestClient, db: Session, order_id: UUID, picker_id: UUID) -> UUID:
    admin = _mk_user(db, username=f"adm-bp-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            f"/api/v1/orders/{order_id}/send-to-picking",
            json={"assigned_to_user_id": str(picker_id)},
        )
        assert res.status_code == 200, res.text
        return UUID(res.json()["pick_task_id"])
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_line_pick_three_boxes(
    client: TestClient,
    db_session: Session,
) -> None:
    order, picker, product, loc, lot, box_barcode = _seed_box_pick_order(db_session)
    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        doc = client.get(f"/api/v1/picking/documents/{doc_id}")
        assert doc.status_code == 200, doc.text
        line = doc.json()["lines"][0]
        line_id = line["id"]
        alts = line.get("alternate_locations") or []
        primary = next((a for a in alts if a.get("is_primary")), None)
        assert primary is not None
        assert primary.get("box_count") == 5
        assert primary.get("units_in_boxes") == 30
        assert primary.get("loose_units") == 0

        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 18,
                "request_id": f"pick-box-{uuid.uuid4().hex}",
                "barcode": box_barcode,
                "box_count": 3,
            },
        )
        assert pick.status_code == 200, pick.text
        assert pick.json()["line"]["qty_picked"] == 18

        bd = get_breakdown(
            db_session,
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
        )
        assert bd.box_count == 2
        assert bd.units_in_boxes == 12
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_line_pick_box_wrong_qty_returns_400(
    client: TestClient,
    db_session: Session,
) -> None:
    order, picker, _product, _loc, _lot, box_barcode = _seed_box_pick_order(db_session)
    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        line_id = client.get(f"/api/v1/picking/documents/{doc_id}").json()["lines"][0]["id"]
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 12,
                "request_id": f"pick-box-bad-{uuid.uuid4().hex}",
                "barcode": box_barcode,
                "box_count": 3,
            },
        )
        assert pick.status_code == 400
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_line_pick_unit_requires_loose(
    client: TestClient,
    db_session: Session,
) -> None:
    order, picker, product, loc, lot, box_barcode = _seed_box_pick_order(
        db_session, order_qty=6, stock_qty=30, box_count=5
    )
    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        line_id = client.get(f"/api/v1/picking/documents/{doc_id}").json()["lines"][0]["id"]
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 3,
                "request_id": f"pick-unit-{uuid.uuid4().hex}",
                "barcode": product.barcode,
            },
        )
        assert pick.status_code == 409
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_line_pick_unit_with_fully_reserved_loose_stock(
    client: TestClient,
    db_session: Session,
) -> None:
    """Ajratilgan (reserved) qutisiz zaxiradan unit skan bilan terish — available=0 bo'lsa ham."""
    order, picker, product, loc, lot = _seed_loose_pick_order(
        db_session, order_qty=4, stock_qty=4
    )
    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    bd_avail = get_breakdown(
        db_session,
        product_id=product.id,
        lot_id=lot.id,
        location_id=loc.id,
    )
    assert bd_avail.loose_units == 0

    bd_pick = get_breakdown_for_pick(
        db_session,
        product_id=product.id,
        lot_id=lot.id,
        location_id=loc.id,
    )
    assert bd_pick.loose_units == 4

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        line_id = client.get(f"/api/v1/picking/documents/{doc_id}").json()["lines"][0]["id"]
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 1,
                "request_id": f"pick-unit-res-{uuid.uuid4().hex}",
                "barcode": product.barcode,
            },
        )
        assert pick.status_code == 200, pick.text
        assert pick.json()["line"]["qty_picked"] == 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_consolidated_pick_five_boxes(
    client: TestClient,
    db_session: Session,
) -> None:
    order, picker, product, loc, lot, box_barcode = _seed_box_pick_order(
        db_session, order_qty=30, stock_qty=30, box_count=5
    )
    _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        pick = client.post(
            "/api/v1/picking/consolidated/pick",
            json={
                "barcode": box_barcode,
                "qty": 30,
                "box_count": 5,
                "request_id": f"cons-box-{uuid.uuid4().hex}",
            },
        )
        assert pick.status_code == 200, pick.text

        bd = get_breakdown(
            db_session,
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
        )
        assert bd.box_count == 0
        assert bd.units_in_boxes == 0
    finally:
        app.dependency_overrides.pop(get_current_user, None)
