from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
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
