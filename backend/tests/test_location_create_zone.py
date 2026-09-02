"""Joylashuv yaratishda zona tanlash (avval faqat tahrirlashda mumkin edi)."""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.security import get_password_hash
from app.models.location import Location
from app.models.user import User


@pytest.fixture
def auth_headers(client: TestClient, db_session: Session) -> dict:
    username = f"adm-zone-{uuid.uuid4().hex[:8]}"
    db_session.add(
        User(
            username=username,
            password_hash=get_password_hash("testpass123"),
            role="warehouse_admin",
            is_active=True,
        )
    )
    db_session.commit()
    r = client.post(
        "/api/v1/auth/login", json={"username": username, "password": "testpass123"}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _create(client: TestClient, headers: dict, **extra):
    body = {
        "location_type": "FLOOR",
        "sector": f"EXP-{uuid.uuid4().hex[:2]}",
        "pallet_no": 1,
        "is_active": True,
        **extra,
    }
    return client.post("/api/v1/locations", json=body, headers=headers)


def test_create_expired_zone_directly(client: TestClient, auth_headers: dict, db_session: Session):
    r = _create(client, auth_headers, zone_type="EXPIRED")
    assert r.status_code == 201, r.text
    assert r.json()["zone_type"] == "EXPIRED"

    row = db_session.query(Location).filter(Location.id == uuid.UUID(r.json()["id"])).one()
    assert row.zone_type == "EXPIRED"


def test_create_damaged_zone_directly(client: TestClient, auth_headers: dict):
    r = _create(client, auth_headers, zone_type="DAMAGED")
    assert r.status_code == 201, r.text
    assert r.json()["zone_type"] == "DAMAGED"


def test_create_defaults_to_normal(client: TestClient, auth_headers: dict):
    """Regressiya: zone_type berilmasa — avvalgidek NORMAL."""
    r = _create(client, auth_headers)
    assert r.status_code == 201, r.text
    assert r.json()["zone_type"] == "NORMAL"


def test_create_rejects_unknown_zone(client: TestClient, auth_headers: dict):
    r = _create(client, auth_headers, zone_type="SOMETHING")
    assert r.status_code == 400, r.text


def test_expired_slot_saved_and_kept_unique(client: TestClient, auth_headers: dict):
    first = _create(client, auth_headers, zone_type="EXPIRED", expired_slot="A")
    assert first.status_code == 201, first.text
    assert first.json()["expired_slot"] == "A"

    # Bitta omborda A slotini ikkinchi faol EXPIRED joy egallay olmaydi.
    second = _create(client, auth_headers, zone_type="EXPIRED", expired_slot="A")
    assert second.status_code == 409, second.text


def test_slot_ignored_for_non_expired_zone(client: TestClient, auth_headers: dict):
    r = _create(client, auth_headers, zone_type="NORMAL", expired_slot="B")
    assert r.status_code == 201, r.text
    assert r.json()["expired_slot"] is None
