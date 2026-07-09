from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.brand import Brand
from app.models.location import Location
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User


@pytest.fixture
def admin_user(db_session: Session) -> User:
    u = User(
        username="idemp_admin",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


@pytest.fixture
def bin_loc(db_session: Session) -> Location:
    loc = Location(
        code="IDEMP-SRC",
        barcode_value="IDEMP-SRC",
        name="Idemp source",
        type="bin",
        is_active=True,
    )
    db_session.add(loc)
    db_session.commit()
    db_session.refresh(loc)
    return loc


@pytest.fixture
def prod(db_session: Session) -> Product:
    p = Product(
        external_source="test",
        external_id="idemp-prod-1",
        name="Idempotent Product",
        sku="SKU-IDEMP-1",
        is_active=True,
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def _seed_receipt(db_session: Session, prod: Product, loc: Location, *, qty: str = "5") -> StockLot:
    lot = StockLot(product_id=prod.id, batch="IDEMP-BATCH", expiry_date=None)
    db_session.add(lot)
    db_session.flush()
    db_session.add(
        StockMovement(
            product_id=prod.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal(qty),
            movement_type="receipt",
        )
    )
    db_session.commit()
    db_session.refresh(lot)
    return lot


def test_movements_idempotency_replays_without_duplicate(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    prod: Product,
    bin_loc: Location,
) -> None:
    lot = _seed_receipt(db_session, prod, bin_loc, qty="9")
    body = {
        "product_id": str(prod.id),
        "lot_id": str(lot.id),
        "location_id": str(bin_loc.id),
        "qty_change": "-2",
        "movement_type": "adjust",
        "reason_code": "inventory_shortage",
    }

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        r1 = client.post("/api/v1/inventory/movements", json=body, headers={"Idempotency-Key": "mov-dup-1"})
        r2 = client.post("/api/v1/inventory/movements", json=body, headers={"Idempotency-Key": "mov-dup-1"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"]

    adjust_rows = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.product_id == prod.id,
            StockMovement.lot_id == lot.id,
            StockMovement.location_id == bin_loc.id,
            StockMovement.movement_type == "adjust",
            StockMovement.reason_code == "inventory_shortage",
        )
        .count()
    )
    assert adjust_rows == 1


def test_movements_idempotency_conflict_on_changed_payload(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    prod: Product,
    bin_loc: Location,
) -> None:
    lot = _seed_receipt(db_session, prod, bin_loc, qty="9")
    body1 = {
        "product_id": str(prod.id),
        "lot_id": str(lot.id),
        "location_id": str(bin_loc.id),
        "qty_change": "-1",
        "movement_type": "adjust",
        "reason_code": "inventory_shortage",
    }
    body2 = {
        **body1,
        "qty_change": "-2",
    }

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        r1 = client.post("/api/v1/inventory/movements", json=body1, headers={"Idempotency-Key": "mov-conflict-1"})
        r2 = client.post("/api/v1/inventory/movements", json=body2, headers={"Idempotency-Key": "mov-conflict-1"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r1.status_code == 201
    assert r2.status_code == 409


def test_transfer_location_idempotency_replays_without_duplicate(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    prod: Product,
    bin_loc: Location,
) -> None:
    dest = Location(code="IDEMP-DEST", barcode_value="IDEMP-DEST", name="Dest", type="bin", is_active=True)
    db_session.add(dest)
    db_session.commit()
    db_session.refresh(dest)

    lot = _seed_receipt(db_session, prod, bin_loc, qty="4")
    body = {
        "from_location_id": str(bin_loc.id),
        "to_location_id": str(dest.id),
        "mode": "partial",
        "lines": [
            {
                "product_id": str(prod.id),
                "lot_id": str(lot.id),
                "qty": "3",
            }
        ],
    }

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        r1 = client.post(
            "/api/v1/inventory/movements/transfer-location",
            json=body,
            headers={"Idempotency-Key": "transfer-dup-1"},
        )
        r2 = client.post(
            "/api/v1/inventory/movements/transfer-location",
            json=body,
            headers={"Idempotency-Key": "transfer-dup-1"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json() == r2.json()

    out_rows = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.location_id == bin_loc.id,
            StockMovement.lot_id == lot.id,
            StockMovement.reason_code == "inventory_shortage",
            StockMovement.movement_type == "adjust",
        )
        .count()
    )
    in_rows = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.location_id == dest.id,
            StockMovement.lot_id == lot.id,
            StockMovement.reason_code == "inventory_overage",
            StockMovement.movement_type == "adjust",
        )
        .count()
    )
    assert out_rows == 1
    assert in_rows == 1


def test_adjust_cannot_reduce_total_below_boxed_units(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    prod: Product,
    bin_loc: Location,
) -> None:
    """Kamaytiruvchi adjust qoldiqni quti ichidagi donadan past tushira olmaydi."""
    from app.models.product_box import ProductBox
    from app.services.box_location_service import box_invariant_holds, place_sealed_boxes

    lot = _seed_receipt(db_session, prod, bin_loc, qty="30")  # 30 jami
    box = ProductBox(box_barcode="BOX-ADJ-T", product_id=prod.id, units_per_box=12, is_active=True)
    db_session.add(box)
    db_session.commit()
    # 1 yopiq quti (12 dona) -> loose 18
    place_sealed_boxes(
        db_session,
        box_barcode="BOX-ADJ-T",
        location_id=bin_loc.id,
        lot_id=lot.id,
        user=admin_user,
        box_count=1,
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        # -20 -> on_hand 10 < quti 12 -> rad
        bad = client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": str(prod.id),
                "lot_id": str(lot.id),
                "location_id": str(bin_loc.id),
                "qty_change": "-20",
                "movement_type": "adjust",
                "reason_code": "inventory_shortage",
            },
            headers={"Idempotency-Key": "adj-bad-1"},
        )
        assert bad.status_code == 409, bad.text

        # -18 -> on_hand 12 == quti 12 -> ok
        ok = client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": str(prod.id),
                "lot_id": str(lot.id),
                "location_id": str(bin_loc.id),
                "qty_change": "-18",
                "movement_type": "adjust",
                "reason_code": "inventory_shortage",
            },
            headers={"Idempotency-Key": "adj-ok-1"},
        )
        assert ok.status_code == 201, ok.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert box_invariant_holds(db_session, lot.id, bin_loc.id)


def test_transfer_location_loose_only_blocks_boxed_stock(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    prod: Product,
    bin_loc: Location,
) -> None:
    """Dona ko'chirish faqat qutisizdan: qutidagi zaxirani dona ko'chirib bo'lmaydi."""
    from app.models.product_box import ProductBox
    from app.services.box_location_service import box_invariant_holds, place_sealed_boxes

    dest = Location(code="LOOSE-DEST", barcode_value="LOOSE-DEST", name="Dest", type="bin", is_active=True)
    db_session.add(dest)
    lot = _seed_receipt(db_session, prod, bin_loc, qty="30")  # 30 jami
    box = ProductBox(box_barcode="BOX-LOOSE-T", product_id=prod.id, units_per_box=12, is_active=True)
    db_session.add(box)
    db_session.commit()
    # 1 yopiq quti (12 dona) -> loose = 18
    place_sealed_boxes(
        db_session,
        box_barcode="BOX-LOOSE-T",
        location_id=bin_loc.id,
        lot_id=lot.id,
        user=admin_user,
        box_count=1,
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        # 20 dona (> 18 loose) -> rad etiladi
        too_much = client.post(
            "/api/v1/inventory/movements/transfer-location",
            json={
                "from_location_id": str(bin_loc.id),
                "to_location_id": str(dest.id),
                "mode": "partial",
                "lines": [{"product_id": str(prod.id), "lot_id": str(lot.id), "qty": "20"}],
            },
            headers={"Idempotency-Key": "loose-block-1"},
        )
        assert too_much.status_code == 400, too_much.text

        # 18 dona (= loose) -> o'tadi, quti joyida qoladi
        ok = client.post(
            "/api/v1/inventory/movements/transfer-location",
            json={
                "from_location_id": str(bin_loc.id),
                "to_location_id": str(dest.id),
                "mode": "partial",
                "lines": [{"product_id": str(prod.id), "lot_id": str(lot.id), "qty": "18"}],
            },
            headers={"Idempotency-Key": "loose-ok-1"},
        )
        assert ok.status_code == 200, ok.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    # Manbada 1 quti (12) qoldi, invariant saqlanadi
    sealed = (
        db_session.query(StockMovement)  # sanity: stock moved
        .filter(StockMovement.location_id == dest.id, StockMovement.lot_id == lot.id)
        .count()
    )
    assert sealed >= 1
    assert box_invariant_holds(db_session, lot.id, bin_loc.id)


def test_transfer_location_full_moves_sealed_boxes_with_loose(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    prod: Product,
    bin_loc: Location,
) -> None:
    """Full rejim ("Butun palet"): loose adjust bilan, yopiq qutilar placement+stock bilan ko'chadi."""
    from app.models.location_box_placement import PLACEMENT_SEALED, LocationBoxPlacement
    from app.models.product_box import ProductBox
    from app.services.box_location_service import box_invariant_holds, place_sealed_boxes

    dest = Location(code="FULL-DEST", barcode_value="FULL-DEST", name="Dest", type="bin", is_active=True)
    db_session.add(dest)
    lot = _seed_receipt(db_session, prod, bin_loc, qty="30")  # 30 jami
    box = ProductBox(box_barcode="BOX-FULL-T", product_id=prod.id, units_per_box=12, is_active=True)
    db_session.add(box)
    db_session.commit()
    # 1 yopiq quti (12 dona) -> loose = 18
    place_sealed_boxes(
        db_session,
        box_barcode="BOX-FULL-T",
        location_id=bin_loc.id,
        lot_id=lot.id,
        user=admin_user,
        box_count=1,
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        resp = client.post(
            "/api/v1/inventory/movements/transfer-location",
            json={
                "from_location_id": str(bin_loc.id),
                "to_location_id": str(dest.id),
                "mode": "full",
            },
            headers={"Idempotency-Key": "full-box-1"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["lines_transferred"] == 1  # loose qatori
    assert payload["boxes_transferred"] == 1
    assert payload["movements_created"] == 4  # loose out/in + quti out/in

    # Placement manzilga ko'chdi
    placements = (
        db_session.query(LocationBoxPlacement)
        .filter(
            LocationBoxPlacement.product_box_id == box.id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
        )
        .all()
    )
    assert len(placements) == 1
    assert placements[0].location_id == dest.id

    # Manbada hech narsa qolmadi, manzilda 30 (18 loose + 12 quti)
    src_total = (
        db_session.query(StockMovement)
        .filter(StockMovement.lot_id == lot.id, StockMovement.location_id == bin_loc.id)
        .all()
    )
    assert sum(m.qty_change for m in src_total) == Decimal("0")
    dest_total = (
        db_session.query(StockMovement)
        .filter(StockMovement.lot_id == lot.id, StockMovement.location_id == dest.id)
        .all()
    )
    assert sum(m.qty_change for m in dest_total) == Decimal("30")

    assert box_invariant_holds(db_session, lot.id, bin_loc.id)
    assert box_invariant_holds(db_session, lot.id, dest.id)


def test_transfer_location_full_boxes_only_no_loose(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    prod: Product,
    bin_loc: Location,
) -> None:
    """Palet to'liq yopiq qutilardan iborat (loose=0): ilgari 400 edi, endi qutilar ko'chadi."""
    from app.models.location_box_placement import PLACEMENT_SEALED, LocationBoxPlacement
    from app.models.product_box import ProductBox
    from app.services.box_location_service import box_invariant_holds, place_sealed_boxes

    dest = Location(code="BOXONLY-DEST", barcode_value="BOXONLY-DEST", name="Dest", type="bin", is_active=True)
    db_session.add(dest)
    lot = _seed_receipt(db_session, prod, bin_loc, qty="24")  # 24 jami
    box = ProductBox(box_barcode="BOX-ONLY-T", product_id=prod.id, units_per_box=12, is_active=True)
    db_session.add(box)
    db_session.commit()
    # 2 yopiq quti (24 dona) -> loose = 0
    place_sealed_boxes(
        db_session,
        box_barcode="BOX-ONLY-T",
        location_id=bin_loc.id,
        lot_id=lot.id,
        user=admin_user,
        box_count=2,
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        resp = client.post(
            "/api/v1/inventory/movements/transfer-location",
            json={
                "from_location_id": str(bin_loc.id),
                "to_location_id": str(dest.id),
                "mode": "full",
            },
            headers={"Idempotency-Key": "full-boxonly-1"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["lines_transferred"] == 0
    assert payload["boxes_transferred"] == 2
    assert payload["movements_created"] == 4  # 2 quti x (out+in)

    placements = (
        db_session.query(LocationBoxPlacement)
        .filter(
            LocationBoxPlacement.product_box_id == box.id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
        )
        .all()
    )
    assert len(placements) == 2
    assert all(p.location_id == dest.id for p in placements)

    dest_total = (
        db_session.query(StockMovement)
        .filter(StockMovement.lot_id == lot.id, StockMovement.location_id == dest.id)
        .all()
    )
    assert sum(m.qty_change for m in dest_total) == Decimal("24")

    assert box_invariant_holds(db_session, lot.id, bin_loc.id)
    assert box_invariant_holds(db_session, lot.id, dest.id)


def test_transfer_location_full_blocked_when_boxes_and_reserve(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    prod: Product,
    bin_loc: Location,
) -> None:
    """Lotda rezerv + yopiq quti bo'lsa full ko'chirish aniq sabab bilan bloklanadi."""
    from app.models.location_box_placement import PLACEMENT_SEALED, LocationBoxPlacement
    from app.models.product_box import ProductBox
    from app.services.box_location_service import place_sealed_boxes

    dest = Location(code="RESV-DEST", barcode_value="RESV-DEST", name="Dest", type="bin", is_active=True)
    db_session.add(dest)
    lot = _seed_receipt(db_session, prod, bin_loc, qty="30")  # 30 jami
    box = ProductBox(box_barcode="BOX-RESV-T", product_id=prod.id, units_per_box=12, is_active=True)
    db_session.add(box)
    db_session.commit()
    # 1 yopiq quti (12 dona) -> loose 18
    place_sealed_boxes(
        db_session,
        box_barcode="BOX-RESV-T",
        location_id=bin_loc.id,
        lot_id=lot.id,
        user=admin_user,
        box_count=1,
    )
    # 5 dona rezerv (terish uchun band)
    db_session.add(
        StockMovement(
            product_id=prod.id,
            lot_id=lot.id,
            location_id=bin_loc.id,
            qty_change=Decimal("5"),
            movement_type="allocate",
        )
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        resp = client.post(
            "/api/v1/inventory/movements/transfer-location",
            json={
                "from_location_id": str(bin_loc.id),
                "to_location_id": str(dest.id),
                "mode": "full",
            },
            headers={"Idempotency-Key": "full-resv-1"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 409, resp.text
    assert "rezerv" in resp.json()["detail"]
    assert "5" in resp.json()["detail"]

    # Hech narsa ko'chmagan: placement manbada, manzilda movement yo'q
    placement = (
        db_session.query(LocationBoxPlacement)
        .filter(
            LocationBoxPlacement.product_box_id == box.id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
        )
        .one()
    )
    assert placement.location_id == bin_loc.id
    dest_movs = (
        db_session.query(StockMovement)
        .filter(StockMovement.lot_id == lot.id, StockMovement.location_id == dest.id)
        .count()
    )
    assert dest_movs == 0


def test_zero_brand_stock_removes_sealed_boxes(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    bin_loc: Location,
) -> None:
    """Brend qoldig'ini nolga tushirganda sealed quti yozuvlari ham tozalanadi (fantom yo'q)."""
    from app.models.location_box_placement import PLACEMENT_SEALED, LocationBoxPlacement
    from app.models.product_box import ProductBox
    from app.services.box_location_service import box_invariant_holds, place_sealed_boxes

    brand = Brand(code="BZBOX", name="Brand box", is_active=True)
    db_session.add(brand)
    db_session.commit()
    db_session.refresh(brand)

    product = Product(
        external_source="test",
        external_id="brand-box-1",
        name="Brand box product",
        sku="SKU-BRAND-BOX-1",
        is_active=True,
        brand_id=brand.id,
    )
    db_session.add(product)
    db_session.commit()
    db_session.refresh(product)

    lot = StockLot(product_id=product.id, batch="BRAND-BOX-BATCH", expiry_date=None)
    db_session.add(lot)
    db_session.flush()
    db_session.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=bin_loc.id,
            qty_change=Decimal("24"),
            movement_type="receipt",
        )
    )
    box = ProductBox(box_barcode="BOX-BRANDZERO", product_id=product.id, units_per_box=12, is_active=True)
    db_session.add(box)
    db_session.commit()
    # 2 yopiq quti (24 dona) -> loose 0
    place_sealed_boxes(
        db_session,
        box_barcode="BOX-BRANDZERO",
        location_id=bin_loc.id,
        lot_id=lot.id,
        user=admin_user,
        box_count=2,
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        resp = client.post(f"/api/v1/inventory/brands/{brand.id}/zero-stock")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["boxes_removed"] == 2

    sealed_remaining = (
        db_session.query(LocationBoxPlacement)
        .filter(
            LocationBoxPlacement.lot_id == lot.id,
            LocationBoxPlacement.location_id == bin_loc.id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
        )
        .count()
    )
    assert sealed_remaining == 0
    # Invariant saqlanadi (fantom quti yo'q)
    assert box_invariant_holds(db_session, lot.id, bin_loc.id)


def test_zero_brand_stock_resets_only_selected_brand(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    bin_loc: Location,
) -> None:
    brand_a = Brand(code="BZA", name="Brand A", is_active=True)
    brand_b = Brand(code="BZB", name="Brand B", is_active=True)
    db_session.add_all([brand_a, brand_b])
    db_session.commit()
    db_session.refresh(brand_a)
    db_session.refresh(brand_b)

    product_a = Product(
        external_source="test",
        external_id="brand-a-1",
        name="Brand A product",
        sku="SKU-BRAND-A-1",
        is_active=True,
        brand_id=brand_a.id,
    )
    product_b = Product(
        external_source="test",
        external_id="brand-b-1",
        name="Brand B product",
        sku="SKU-BRAND-B-1",
        is_active=True,
        brand_id=brand_b.id,
    )
    db_session.add_all([product_a, product_b])
    db_session.commit()
    db_session.refresh(product_a)
    db_session.refresh(product_b)

    lot_a = StockLot(product_id=product_a.id, batch="BRAND-A-BATCH", expiry_date=None)
    lot_b = StockLot(product_id=product_b.id, batch="BRAND-B-BATCH", expiry_date=None)
    db_session.add_all([lot_a, lot_b])
    db_session.flush()
    db_session.add_all(
        [
            StockMovement(
                product_id=product_a.id,
                lot_id=lot_a.id,
                location_id=bin_loc.id,
                qty_change=Decimal("6"),
                movement_type="receipt",
            ),
            StockMovement(
                product_id=product_b.id,
                lot_id=lot_b.id,
                location_id=bin_loc.id,
                qty_change=Decimal("7"),
                movement_type="receipt",
            ),
        ]
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        resp = client.post(f"/api/v1/inventory/brands/{brand_a.id}/zero-stock")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["products_affected"] == 1
    assert payload["movements_created"] == 1

    brand_a_adjust_rows = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.product_id == product_a.id,
            StockMovement.lot_id == lot_a.id,
            StockMovement.location_id == bin_loc.id,
            StockMovement.movement_type == "adjust",
            StockMovement.reason_code == "inventory_shortage",
        )
        .all()
    )
    assert len(brand_a_adjust_rows) == 1
    assert brand_a_adjust_rows[0].qty_change == Decimal("-6")

    brand_b_adjust_count = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.product_id == product_b.id,
            StockMovement.movement_type == "adjust",
            StockMovement.reason_code == "inventory_shortage",
        )
        .count()
    )
    assert brand_b_adjust_count == 0


def test_zero_brand_stock_idempotency_prevents_duplicate_adjustments(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    bin_loc: Location,
) -> None:
    brand = Brand(code="BZI", name="Brand Idempotent", is_active=True)
    db_session.add(brand)
    db_session.commit()
    db_session.refresh(brand)

    product = Product(
        external_source="test",
        external_id="brand-idem-1",
        name="Brand idem product",
        sku="SKU-BRAND-IDEM-1",
        is_active=True,
        brand_id=brand.id,
    )
    db_session.add(product)
    db_session.commit()
    db_session.refresh(product)

    lot = StockLot(product_id=product.id, batch="BRAND-IDEM-BATCH", expiry_date=None)
    db_session.add(lot)
    db_session.flush()
    db_session.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=bin_loc.id,
            qty_change=Decimal("5"),
            movement_type="receipt",
        )
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        r1 = client.post(
            f"/api/v1/inventory/brands/{brand.id}/zero-stock",
            headers={"Idempotency-Key": "zero-brand-dup-1"},
        )
        r2 = client.post(
            f"/api/v1/inventory/brands/{brand.id}/zero-stock",
            headers={"Idempotency-Key": "zero-brand-dup-1"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json() == r2.json()

    adjust_rows = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.product_id == product.id,
            StockMovement.lot_id == lot.id,
            StockMovement.location_id == bin_loc.id,
            StockMovement.movement_type == "adjust",
            StockMovement.reason_code == "inventory_shortage",
        )
        .count()
    )
    assert adjust_rows == 1


def test_zero_brand_stock_reserve_only_creates_unallocate(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    bin_loc: Location,
) -> None:
    brand = Brand(code="BZR", name="Brand Reserve", is_active=True)
    db_session.add(brand)
    db_session.commit()
    db_session.refresh(brand)

    product = Product(
        external_source="test",
        external_id="brand-reserve-1",
        name="Brand reserve product",
        sku="SKU-BRAND-RESERVE-1",
        is_active=True,
        brand_id=brand.id,
    )
    db_session.add(product)
    db_session.commit()
    db_session.refresh(product)

    lot = StockLot(product_id=product.id, batch="BRAND-RESERVE-BATCH", expiry_date=None)
    db_session.add(lot)
    db_session.flush()
    db_session.add_all(
        [
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=bin_loc.id,
                qty_change=Decimal("5"),
                movement_type="receipt",
            ),
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=bin_loc.id,
                qty_change=Decimal("5"),
                movement_type="allocate",
            ),
        ]
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        resp = client.post(f"/api/v1/inventory/brands/{brand.id}/zero-stock?mode=reserve_only")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["stock_movements_created"] == 0
    assert payload["reserve_movements_created"] == 1
    assert payload["movements_created"] == 1

    unalloc_rows = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.product_id == product.id,
            StockMovement.lot_id == lot.id,
            StockMovement.location_id == bin_loc.id,
            StockMovement.movement_type == "unallocate",
            StockMovement.qty_change == Decimal("-5"),
        )
        .count()
    )
    assert unalloc_rows == 1


def test_zero_brand_stock_brand_and_reserve_creates_both_movements(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    bin_loc: Location,
) -> None:
    brand = Brand(code="BZAR", name="Brand both", is_active=True)
    db_session.add(brand)
    db_session.commit()
    db_session.refresh(brand)

    product = Product(
        external_source="test",
        external_id="brand-both-1",
        name="Brand both product",
        sku="SKU-BRAND-BOTH-1",
        is_active=True,
        brand_id=brand.id,
    )
    db_session.add(product)
    db_session.commit()
    db_session.refresh(product)

    lot = StockLot(product_id=product.id, batch="BRAND-BOTH-BATCH", expiry_date=None)
    db_session.add(lot)
    db_session.flush()
    db_session.add_all(
        [
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=bin_loc.id,
                qty_change=Decimal("7"),
                movement_type="receipt",
            ),
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=bin_loc.id,
                qty_change=Decimal("2"),
                movement_type="allocate",
            ),
        ]
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        resp = client.post(f"/api/v1/inventory/brands/{brand.id}/zero-stock?mode=brand_and_reserve")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["stock_movements_created"] == 1
    assert payload["reserve_movements_created"] == 1
    assert payload["movements_created"] == 2

    adjust_rows = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.product_id == product.id,
            StockMovement.lot_id == lot.id,
            StockMovement.location_id == bin_loc.id,
            StockMovement.movement_type == "adjust",
            StockMovement.reason_code == "inventory_shortage",
            StockMovement.qty_change == Decimal("-7"),
        )
        .count()
    )
    assert adjust_rows == 1

    unalloc_rows = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.product_id == product.id,
            StockMovement.lot_id == lot.id,
            StockMovement.location_id == bin_loc.id,
            StockMovement.movement_type == "unallocate",
            StockMovement.qty_change == Decimal("-2"),
        )
        .count()
    )
    assert unalloc_rows == 1


def test_zero_brand_stock_reserve_only_idempotency_no_duplicate_unallocate(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    bin_loc: Location,
) -> None:
    brand = Brand(code="BZRI", name="Brand Reserve Idem", is_active=True)
    db_session.add(brand)
    db_session.commit()
    db_session.refresh(brand)

    product = Product(
        external_source="test",
        external_id="brand-reserve-idem-1",
        name="Brand reserve idem product",
        sku="SKU-BRAND-RESERVE-IDEM-1",
        is_active=True,
        brand_id=brand.id,
    )
    db_session.add(product)
    db_session.commit()
    db_session.refresh(product)

    lot = StockLot(product_id=product.id, batch="BRAND-RESERVE-IDEM-BATCH", expiry_date=None)
    db_session.add(lot)
    db_session.flush()
    db_session.add_all(
        [
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=bin_loc.id,
                qty_change=Decimal("3"),
                movement_type="receipt",
            ),
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=bin_loc.id,
                qty_change=Decimal("3"),
                movement_type="allocate",
            ),
        ]
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        r1 = client.post(
            f"/api/v1/inventory/brands/{brand.id}/zero-stock?mode=reserve_only",
            headers={"Idempotency-Key": "zero-brand-reserve-dup-1"},
        )
        r2 = client.post(
            f"/api/v1/inventory/brands/{brand.id}/zero-stock?mode=reserve_only",
            headers={"Idempotency-Key": "zero-brand-reserve-dup-1"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json() == r2.json()

    unalloc_rows = (
        db_session.query(StockMovement)
        .filter(
            StockMovement.product_id == product.id,
            StockMovement.lot_id == lot.id,
            StockMovement.location_id == bin_loc.id,
            StockMovement.movement_type == "unallocate",
            StockMovement.qty_change == Decimal("-3"),
        )
        .count()
    )
    assert unalloc_rows == 1
