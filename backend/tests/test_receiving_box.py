"""Quti bo'yicha qabul va placement testlari."""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.expiry import normalize_expiry_to_first_of_month
from app.models.location import Location
from app.models.product import Product
from app.models.product_box import ProductBox
from app.models.user import User
from app.services.box_location_service import get_breakdown


@pytest.fixture
def auth_headers(client: TestClient, test_user: User) -> dict[str, str]:
    r = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"},
    )
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_complete_receipt_with_box_metadata_places_sealed_boxes(
    client: TestClient,
    db_session: Session,
    test_product: Product,
    test_location: Location,
    auth_headers: dict[str, str],
) -> None:
    box = ProductBox(
        box_barcode="RCPT-BOX-001",
        product_id=test_product.id,
        units_per_box=10,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()

    raw_expiry = date.today() + timedelta(days=90)
    expiry_sent = raw_expiry.isoformat()
    expected_expiry = normalize_expiry_to_first_of_month(raw_expiry)

    create = client.post(
        "/api/v1/receiving/receipts",
        json={
            "lines": [
                {
                    "product_id": str(test_product.id),
                    "qty": 80,
                    "batch": "BOX-BATCH-1",
                    "expiry_date": expiry_sent,
                    "location_id": str(test_location.id),
                    "box_barcode": "RCPT-BOX-001",
                    "box_count": 8,
                }
            ]
        },
        headers=auth_headers,
    )
    assert create.status_code == 201
    data = create.json()
    assert data["lines"][0]["box_barcode"] == "RCPT-BOX-001"
    assert data["lines"][0]["box_count"] == 8

    receipt_id = data["id"]
    complete = client.post(
        f"/api/v1/receiving/receipts/{receipt_id}/complete",
        headers=auth_headers,
    )
    assert complete.status_code == 200

    from app.models.stock import StockLot

    lot = db_session.query(StockLot).filter(
        StockLot.product_id == test_product.id,
        StockLot.batch == "BOX-BATCH-1",
    ).one()
    assert lot.expiry_date == expected_expiry

    bd = get_breakdown(
        db_session,
        product_id=test_product.id,
        lot_id=lot.id,
        location_id=test_location.id,
    )
    assert bd.box_count == 8
    assert bd.units_in_boxes == 80
    assert bd.loose_units == 0
    assert bd.total_units == 80


def test_complete_receipt_hybrid_box_and_loose_units(
    client: TestClient,
    db_session: Session,
    test_product: Product,
    test_location: Location,
    auth_headers: dict[str, str],
) -> None:
    box = ProductBox(
        box_barcode="RCPT-BOX-HYBRID",
        product_id=test_product.id,
        units_per_box=6,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()

    raw_expiry = date.today() + timedelta(days=90)
    expiry_sent = raw_expiry.isoformat()

    create = client.post(
        "/api/v1/receiving/receipts",
        json={
            "lines": [
                {
                    "product_id": str(test_product.id),
                    "qty": 36,
                    "batch": "BOX-HYBRID-1",
                    "expiry_date": expiry_sent,
                    "location_id": str(test_location.id),
                    "box_barcode": "RCPT-BOX-HYBRID",
                    "box_count": 5,
                }
            ]
        },
        headers=auth_headers,
    )
    assert create.status_code == 201

    receipt_id = create.json()["id"]
    complete = client.post(
        f"/api/v1/receiving/receipts/{receipt_id}/complete",
        headers=auth_headers,
    )
    assert complete.status_code == 200

    from app.models.stock import StockLot

    lot = db_session.query(StockLot).filter(
        StockLot.product_id == test_product.id,
        StockLot.batch == "BOX-HYBRID-1",
    ).one()

    bd = get_breakdown(
        db_session,
        product_id=test_product.id,
        lot_id=lot.id,
        location_id=test_location.id,
    )
    assert bd.box_count == 5
    assert bd.units_in_boxes == 30
    assert bd.loose_units == 6
    assert bd.total_units == 36
