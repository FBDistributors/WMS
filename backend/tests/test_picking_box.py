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
from app.models.location_box_placement import LocationBoxPlacement, PLACEMENT_SEALED
from app.models.stock import StockLot, StockMovement
from app.models.user import User as UserModel
from app.auth.security import get_password_hash
from app.services.box_location_service import (
    get_breakdown,
    get_breakdown_for_pick,
    get_breakdown_tolerant,
    place_sealed_boxes,
)


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
        # Ajratilgandan keyin available=12, sealed 30>12 — inventar kabi dona deb ko'rsatiladi.
        assert primary.get("box_count") == 0
        assert primary.get("loose_units") == 12

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
    """Barcha zaxira qutida, available=0 — dona terish bloklanadi."""
    order, picker, product, loc, lot, box_barcode = _seed_box_pick_order(
        db_session, order_qty=30, stock_qty=30, box_count=5
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
        assert pick.status_code in (400, 409)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_line_pick_loose_when_barcode_is_also_box_barcode(
    client: TestClient,
    db_session: Session,
) -> None:
    """Mahsulot barcode quti kodi bilan bir xil bo'lsa ham qutisiz terish ishlaydi."""
    order, picker, product, loc, lot = _seed_loose_pick_order(
        db_session, order_qty=2, stock_qty=5
    )
    db_session.add(
        ProductBoxModel(
            box_barcode=product.barcode,
            product_id=product.id,
            units_per_box=8,
            is_active=True,
        )
    )
    db_session.commit()

    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        line_id = client.get(f"/api/v1/picking/documents/{doc_id}").json()["lines"][0]["id"]
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 2,
                "request_id": f"pick-dual-bc-{uuid.uuid4().hex}",
                "barcode": product.barcode,
            },
        )
        assert pick.status_code == 200, pick.text
        assert pick.json()["line"]["qty_picked"] == 2
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _seed_box_only_pick_order(
    db: Session,
    *,
    order_qty: int = 8,
    units_per_box: int = 8,
) -> tuple[Order, UserModel, ProductModel, LocationModel, StockLot, str]:
    """Barcha zaxira faqat sealed qutida (loose=0), mahsulot barcode = quti barcode."""
    order, picker, product, loc, lot, box_barcode = _seed_box_pick_order(
        db,
        order_qty=order_qty,
        stock_qty=order_qty,
        box_count=1,
    )
    box = (
        db.query(ProductBoxModel)
        .filter(ProductBoxModel.box_barcode == box_barcode)
        .one()
    )
    box.units_per_box = units_per_box
    product.barcode = box_barcode
    db.commit()
    db.refresh(product)
    return order, picker, product, loc, lot, box_barcode


def test_line_pick_auto_box_when_loose_zero_and_qty_matches_upb(
    client: TestClient,
    db_session: Session,
) -> None:
    """Qutisiz 0, to'liq quti miqdori — box_count yuborilmasa ham avto quti terish."""
    order, picker, product, loc, lot, box_barcode = _seed_box_only_pick_order(
        db_session, order_qty=8, units_per_box=8
    )
    bd = get_breakdown_for_pick(
        db_session,
        product_id=product.id,
        lot_id=lot.id,
        location_id=loc.id,
    )
    assert bd.loose_units == 0
    assert bd.box_count >= 1

    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        line_id = client.get(f"/api/v1/picking/documents/{doc_id}").json()["lines"][0]["id"]
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 8,
                "request_id": f"pick-auto-box-{uuid.uuid4().hex}",
                "barcode": box_barcode,
            },
        )
        assert pick.status_code == 200, pick.text
        assert pick.json()["line"]["qty_picked"] == 8
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_line_pick_box_required_when_partial_box_qty(
    client: TestClient,
    db_session: Session,
) -> None:
    """Qutisiz 0, qisman miqdor — box_count talab qilinadi."""
    order, picker, product, _loc, _lot, box_barcode = _seed_box_only_pick_order(
        db_session, order_qty=8, units_per_box=8
    )
    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        line_id = client.get(f"/api/v1/picking/documents/{doc_id}").json()["lines"][0]["id"]
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 2,
                "request_id": f"pick-partial-box-{uuid.uuid4().hex}",
                "barcode": box_barcode,
            },
        )
        assert pick.status_code == 400
        assert "box_count required for box scan" in pick.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _seed_box_only_separate_unit_barcode_order(
    db: Session,
    *,
    order_qty: int = 8,
    units_per_box: int = 8,
) -> tuple[Order, UserModel, ProductModel, LocationModel, StockLot, str, str]:
    """Qutida zaxira; mahsulot dona barcode quti barcodedan farq qiladi."""
    order, picker, product, loc, lot, box_barcode = _seed_box_pick_order(
        db,
        order_qty=order_qty,
        stock_qty=max(order_qty, units_per_box),
        box_count=1,
    )
    unit_barcode = f"UNIT-{uuid.uuid4().hex[:8]}"
    box = (
        db.query(ProductBoxModel)
        .filter(ProductBoxModel.box_barcode == box_barcode)
        .one()
    )
    box.units_per_box = units_per_box
    product.barcode = unit_barcode
    db.commit()
    db.refresh(product)
    return order, picker, product, loc, lot, unit_barcode, box_barcode


def test_line_pick_unit_barcode_box_only_stock_returns_box_required(
    client: TestClient,
    db_session: Session,
) -> None:
    """Dona barcode, faqat qutida zaxira, qisman miqdor — box_count talab qilinadi (409 emas)."""
    order, picker, product, loc, lot, unit_barcode, _box_barcode = (
        _seed_box_only_separate_unit_barcode_order(
            db_session, order_qty=8, units_per_box=8
        )
    )
    bd = get_breakdown_for_pick(
        db_session,
        product_id=product.id,
        lot_id=lot.id,
        location_id=loc.id,
    )
    assert bd.loose_units == 0
    assert bd.box_count >= 1

    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        line_id = client.get(f"/api/v1/picking/documents/{doc_id}").json()["lines"][0]["id"]
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 2,
                "request_id": f"pick-unit-boxonly-{uuid.uuid4().hex}",
                "barcode": unit_barcode,
            },
        )
        assert pick.status_code == 400, pick.text
        assert "box_count required for box scan" in pick.text
        assert "Qutisiz qoldiq yetarli emas" not in pick.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_line_pick_unit_barcode_auto_full_box(
    client: TestClient,
    db_session: Session,
) -> None:
    """Dona barcode, faqat qutida zaxira, to'liq quti miqdori — avto quti terish."""
    order, picker, product, _loc, _lot, unit_barcode, _box_barcode = (
        _seed_box_only_separate_unit_barcode_order(
            db_session, order_qty=8, units_per_box=8
        )
    )
    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        line_id = client.get(f"/api/v1/picking/documents/{doc_id}").json()["lines"][0]["id"]
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 8,
                "request_id": f"pick-unit-fullbox-{uuid.uuid4().hex}",
                "barcode": unit_barcode,
            },
        )
        assert pick.status_code == 200, pick.text
        assert pick.json()["line"]["qty_picked"] == 8
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_loose_error_not_shown_when_only_boxes(
    client: TestClient,
    db_session: Session,
) -> None:
    """Faqat qutida zaxira, available=0 — dona terish bloklanadi."""
    order, picker, product, _loc, _lot, unit_barcode, _box_barcode = (
        _seed_box_only_separate_unit_barcode_order(
            db_session, order_qty=8, units_per_box=8
        )
    )
    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        line_id = client.get(f"/api/v1/picking/documents/{doc_id}").json()["lines"][0]["id"]
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 1,
                "request_id": f"pick-unit-loose-msg-{uuid.uuid4().hex}",
                "barcode": unit_barcode,
            },
        )
        assert pick.status_code == 400, pick.text
        assert "box_count required for box scan" in pick.text
        assert "Qutisiz qoldiq yetarli emas" not in pick.text
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


def test_line_pick_unit_with_orphan_sealed_placements(
    client: TestClient,
    db_session: Session,
) -> None:
    """Orphan sealed yozuvlari on_hand dan katta bo'lsa ham dona terish ishlaydi."""
    order, picker, product, loc, lot = _seed_loose_pick_order(
        db_session, order_qty=1, stock_qty=10
    )
    box = ProductBoxModel(
        box_barcode=f"BOX-ORPH-{uuid.uuid4().hex[:6]}",
        product_id=product.id,
        units_per_box=10,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()
    for _ in range(5):
        db_session.add(
            LocationBoxPlacement(
                product_box_id=box.id,
                location_id=loc.id,
                lot_id=lot.id,
                status=PLACEMENT_SEALED,
                placed_by_user_id=picker.id,
            )
        )
    db_session.commit()

    bd_pick = get_breakdown_for_pick(
        db_session,
        product_id=product.id,
        lot_id=lot.id,
        location_id=loc.id,
    )
    assert bd_pick.data_inconsistent is True
    assert bd_pick.loose_units == 10

    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        line_id = client.get(f"/api/v1/picking/documents/{doc_id}").json()["lines"][0]["id"]
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 1,
                "request_id": f"pick-orphan-{uuid.uuid4().hex}",
                "barcode": product.barcode,
            },
        )
        assert pick.status_code == 200, pick.text
        assert pick.json()["line"]["qty_picked"] == 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_line_pick_loose_when_sealed_exceeds_available(
    client: TestClient,
    db_session: Session,
) -> None:
    """on_hand=624, available=620, 52×12 sealed — inventar va terish dona deb ko'rsatadi."""
    picker = _mk_user(db_session, username=f"picker-sav-{uuid.uuid4().hex[:8]}", role="picker")
    product = ProductModel(
        external_source="test",
        external_id=f"ext-{uuid.uuid4()}",
        name="Sealed Exceeds Available Product",
        sku=f"SKU-SAV-{uuid.uuid4().hex[:8]}",
        barcode=f"SAV{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()

    loc = LocationModel(
        code=f"SAV-{uuid.uuid4().hex[:6]}",
        barcode_value=f"SAV-{uuid.uuid4().hex[:6]}",
        name="Sealed exceeds available bin",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    db_session.add(loc)
    db_session.flush()

    lot = StockLot(product_id=product.id, batch="SAV-B1", expiry_date=None)
    db_session.add(lot)
    db_session.flush()

    db_session.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal("624"),
            movement_type="receipt",
        )
    )

    box_barcode = f"BOX-SAV-{uuid.uuid4().hex[:6]}"
    db_session.add(
        ProductBoxModel(
            box_barcode=box_barcode,
            product_id=product.id,
            units_per_box=12,
            is_active=True,
        )
    )
    db_session.flush()

    inv = _mk_user(
        db_session, username=f"inv-sav-{uuid.uuid4().hex[:8]}", role="inventory_controller"
    )
    place_sealed_boxes(
        db_session,
        box_barcode=box_barcode,
        location_id=loc.id,
        lot_id=lot.id,
        user=inv,
        box_count=52,
    )
    db_session.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal("4"),
            movement_type="allocate",
        )
    )

    order = Order(
        source="test",
        source_external_id=f"order-sav-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-SAV-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = [
        OrderLine(
            sku=product.sku,
            name="Loose when sealed exceeds available",
            qty=2.0,
            uom="dona",
        )
    ]
    db_session.add(order)
    db_session.commit()

    bd_inv = get_breakdown_tolerant(
        db_session,
        product_id=product.id,
        lot_id=lot.id,
        location_id=loc.id,
    )
    assert bd_inv.box_count == 0
    assert bd_inv.loose_units == 620

    bd_pick = get_breakdown_for_pick(
        db_session,
        product_id=product.id,
        lot_id=lot.id,
        location_id=loc.id,
    )
    assert bd_pick.loose_units == 620

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
        assert primary.get("box_count") == 0
        assert primary.get("loose_units") == int(primary.get("available_qty") or 0)

        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 2,
                "request_id": f"pick-sav-{uuid.uuid4().hex}",
                "barcode": product.barcode,
            },
        )
        assert pick.status_code == 200, pick.text
        assert pick.json()["line"]["qty_picked"] == 2
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


def _seed_hybrid_pick_order(
    db: Session,
    *,
    order_qty: int = 14,
    box_count: int = 2,
    loose_qty: int = 2,
) -> tuple[Order, UserModel, ProductModel, LocationModel, StockLot, str]:
    """2 quti (12 dona) + qo'shimcha 2 dona — gibrid terish testi."""
    assert box_count * 6 + loose_qty == order_qty
    picker = _mk_user(db, username=f"picker-hyb-{uuid.uuid4().hex[:8]}", role="picker")
    product = ProductModel(
        external_source="test",
        external_id=f"ext-{uuid.uuid4()}",
        name="Hybrid Pick Product",
        sku=f"SKU-HP-{uuid.uuid4().hex[:8]}",
        barcode=f"HP{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db.add(product)
    db.flush()

    loc = LocationModel(
        code=f"HP-{uuid.uuid4().hex[:6]}",
        barcode_value=f"HP-{uuid.uuid4().hex[:6]}",
        name="Hybrid pick bin",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    db.add(loc)
    db.flush()

    lot = StockLot(product_id=product.id, batch="HP-B1", expiry_date=None)
    db.add(lot)
    db.flush()
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal(str(order_qty)),
            movement_type="receipt",
        )
    )

    box_barcode = f"BOX-HP-{uuid.uuid4().hex[:6]}"
    box = ProductBoxModel(
        box_barcode=box_barcode,
        product_id=product.id,
        units_per_box=6,
        is_active=True,
    )
    db.add(box)
    db.flush()

    inv = _mk_user(db, username=f"inv-hyb-{uuid.uuid4().hex[:8]}", role="inventory_controller")
    place_sealed_boxes(
        db,
        box_barcode=box_barcode,
        location_id=loc.id,
        lot_id=lot.id,
        user=inv,
        box_count=box_count,
    )

    bd = get_breakdown(
        db,
        product_id=product.id,
        lot_id=lot.id,
        location_id=loc.id,
    )
    assert bd.box_count == box_count
    assert bd.units_in_boxes == box_count * 6
    assert bd.loose_units == loose_qty

    order = Order(
        source="test",
        source_external_id=f"order-hp-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-HP-{uuid.uuid4().hex[:6]}",
    )
    order.wms_state = OrderWmsState(status="imported")
    order.lines = [
        OrderLine(
            sku=product.sku,
            name="Hybrid pick line",
            qty=float(order_qty),
            uom="dona",
        )
    ]
    db.add(order)
    db.commit()
    db.refresh(order)
    return order, picker, product, loc, lot, box_barcode


def test_consolidated_hybrid_two_boxes_then_two_loose(
    client: TestClient,
    db_session: Session,
) -> None:
    """Ketma-ket: quti pick (12) + dona pick (2) = 14."""
    order, picker, product, loc, lot, box_barcode = _seed_hybrid_pick_order(db_session)
    _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        box_pick = client.post(
            "/api/v1/picking/consolidated/pick",
            json={
                "barcode": box_barcode,
                "qty": 12,
                "box_count": 2,
                "request_id": f"cons-hyb-box-{uuid.uuid4().hex}",
            },
        )
        assert box_pick.status_code == 200, box_pick.text

        unit_pick = client.post(
            "/api/v1/picking/consolidated/pick",
            json={
                "barcode": product.barcode,
                "qty": 2,
                "request_id": f"cons-hyb-unit-{uuid.uuid4().hex}",
            },
        )
        assert unit_pick.status_code == 200, unit_pick.text

        bd = get_breakdown(
            db_session,
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
        )
        assert bd.box_count == 0
        assert bd.units_in_boxes == 0
        assert bd.loose_units == 0
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_line_pick_hybrid_single_request(
    client: TestClient,
    db_session: Session,
) -> None:
    """Bitta so'rov: 2 quti (12) + 2 dona = 14."""
    order, picker, product, loc, lot, box_barcode = _seed_hybrid_pick_order(db_session)
    doc_id = _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        line_id = client.get(f"/api/v1/picking/documents/{doc_id}").json()["lines"][0]["id"]
        pick = client.post(
            f"/api/v1/picking/lines/{line_id}/pick",
            json={
                "delta": 14,
                "request_id": f"pick-hyb-line-{uuid.uuid4().hex}",
                "barcode": product.barcode,
                "box_barcode": box_barcode,
                "box_count": 2,
            },
        )
        assert pick.status_code == 200, pick.text
        assert pick.json()["line"]["qty_picked"] == 14

        bd = get_breakdown(
            db_session,
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
        )
        assert bd.box_count == 0
        assert bd.units_in_boxes == 0
        assert bd.loose_units == 0
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_consolidated_hybrid_single_request(
    client: TestClient,
    db_session: Session,
) -> None:
    """Bitta so'rov: quti + dona gibrid terish."""
    order, picker, product, loc, lot, box_barcode = _seed_hybrid_pick_order(db_session)
    _send_to_picking(client, db_session, order.id, picker.id)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        hybrid_pick = client.post(
            "/api/v1/picking/consolidated/pick",
            json={
                "barcode": product.barcode,
                "box_barcode": box_barcode,
                "box_count": 2,
                "qty": 14,
                "request_id": f"cons-hyb-single-{uuid.uuid4().hex}",
            },
        )
        assert hybrid_pick.status_code == 200, hybrid_pick.text

        bd = get_breakdown(
            db_session,
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
        )
        assert bd.box_count == 0
        assert bd.units_in_boxes == 0
        assert bd.loose_units == 0
    finally:
        app.dependency_overrides.pop(get_current_user, None)
