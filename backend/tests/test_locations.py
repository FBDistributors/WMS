"""
Tests for location structure: RACK (S-{sector}-{level}-{row}), FLOOR (P-{sector}-{palletNo}).
"""
import pytest
from decimal import Decimal
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.location import Location
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.auth.security import get_password_hash


@pytest.fixture
def admin_user(db_session: Session) -> User:
    u = User(
        username="admin_locations",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


@pytest.fixture
def auth_headers(client: TestClient, admin_user: User) -> dict:
    r = client.post(
        "/api/v1/auth/login",
        json={"username": "admin_locations", "password": "testpass123"},
    )
    assert r.status_code == 200
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_create_rack_location_works(client: TestClient, auth_headers: dict):
    """Creating a Rack location S-15-01-02 works and returns location_type RACK."""
    r = client.post(
        "/api/v1/locations",
        json={
            "code": "S-15-01-02",
            "name": "Rack 15 Level 1 Row 2",
            "type": "rack",
            "location_type": "RACK",
            "is_active": True,
        },
        headers=auth_headers,
    )
    assert r.status_code == 201
    data = r.json()
    assert data["code"] == "S-15-01-02"
    assert data["location_type"] == "RACK"
    assert data["sector"] == "15"
    assert data["level"] == 1
    assert data["row_no"] == 2
    assert data["pallet_no"] is None


def test_create_floor_location_works(client: TestClient, auth_headers: dict):
    """Creating a Floor location P-AS-02 works and returns location_type FLOOR."""
    r = client.post(
        "/api/v1/locations",
        json={
            "code": "P-AS-02",
            "name": "Floor pallet AS 02",
            "type": "rack",
            "location_type": "FLOOR",
            "is_active": True,
        },
        headers=auth_headers,
    )
    assert r.status_code == 201
    data = r.json()
    assert data["code"] == "P-AS-02"
    assert data["location_type"] == "FLOOR"
    assert data["sector"] == "AS"
    assert data["level"] is None
    assert data["row_no"] is None
    assert data["pallet_no"] == 2


def test_create_location_duplicate_code_fails(client: TestClient, auth_headers: dict):
    """Duplicate location code returns 409."""
    r1 = client.post(
        "/api/v1/locations",
        json={
            "code": "S-10-01-01",
            "name": "Rack 10",
            "type": "rack",
            "location_type": "RACK",
            "is_active": True,
        },
        headers=auth_headers,
    )
    assert r1.status_code == 201
    r2 = client.post(
        "/api/v1/locations",
        json={
            "code": "S-10-01-01",
            "name": "Duplicate",
            "type": "rack",
            "is_active": True,
        },
        headers=auth_headers,
    )
    assert r2.status_code == 409
    assert "already exists" in r2.json().get("detail", "").lower()


def test_inventory_summary_by_location_shows_product_per_location(
    client: TestClient,
    auth_headers: dict,
    db_session: Session,
):
    """Inventory summary-by-location returns one row per (product, location) with location_code and location_type."""
    # Create two locations (RACK and FLOOR) directly so we have location_type set
    loc_rack = Location(
        code="S-1-01-01",
        name="Rack 1",
        type="rack",
        location_type="RACK",
        sector="1",
        level=1,
        row_no=1,
        is_active=True,
    )
    loc_floor = Location(
        code="P-X-01",
        name="Floor X",
        type="rack",
        location_type="FLOOR",
        sector="X",
        pallet_no=1,
        is_active=True,
    )
    db_session.add(loc_rack)
    db_session.add(loc_floor)
    db_session.flush()

    product = Product(
        external_source="test",
        external_id="ext-inv",
        name="Product Multi Loc",
        sku="SKU-ML",
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()

    lot = StockLot(product_id=product.id, batch="B1")
    db_session.add(lot)
    db_session.flush()

    StockMovement(
        product_id=product.id,
        lot_id=lot.id,
        location_id=loc_rack.id,
        qty_change=Decimal("5"),
        movement_type="receipt",
    )
    StockMovement(
        product_id=product.id,
        lot_id=lot.id,
        location_id=loc_floor.id,
        qty_change=Decimal("3"),
        movement_type="receipt",
    )
    db_session.commit()

    r = client.get(
        "/api/v1/inventory/summary-by-location",
        headers=auth_headers,
    )
    assert r.status_code == 200
    rows = r.json()
    product_rows = [row for row in rows if row["product_id"] == str(product.id)]
    assert len(product_rows) == 2
    codes = {row["location_code"] for row in product_rows}
    assert codes == {"S-1-01-01", "P-X-01"}
    types = {row["location_type"] for row in product_rows}
    assert types == {"RACK", "FLOOR"}
    by_code = {row["location_code"]: row for row in product_rows}
    assert by_code["S-1-01-01"]["available"] == 5
    assert by_code["P-X-01"]["available"] == 3
