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
