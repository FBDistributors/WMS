"""CRUD for settings_organizations reference list."""
from __future__ import annotations

from fastapi.testclient import TestClient


def _login(client: TestClient, username: str, password: str) -> dict[str, str]:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_settings_organizations_api_crud(client: TestClient, test_user) -> None:
    headers = _login(client, test_user.username, "testpass123")

    create = client.post(
        "/api/v1/settings-organizations",
        json={"org_id": "1001", "name": "Test org"},
        headers=headers,
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["org_id"] == "1001"
    assert body["name"] == "Test org"
    item_id = body["id"]

    listing = client.get("/api/v1/settings-organizations", headers=headers)
    assert listing.status_code == 200
    assert any(x["id"] == item_id for x in listing.json())

    update = client.put(
        f"/api/v1/settings-organizations/{item_id}",
        json={"name": "Renamed"},
        headers=headers,
    )
    assert update.status_code == 200
    assert update.json()["name"] == "Renamed"

    delete = client.delete(f"/api/v1/settings-organizations/{item_id}", headers=headers)
    assert delete.status_code == 204

    dup = client.post(
        "/api/v1/settings-organizations",
        json={"org_id": "1001", "name": "Dup"},
        headers=headers,
    )
    assert dup.status_code == 201
    dup2 = client.post(
        "/api/v1/settings-organizations",
        json={"org_id": "1001", "name": "Dup2"},
        headers=headers,
    )
    assert dup2.status_code == 409
