"""Tests for mobile app feedback API."""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.user_app_feedback import UserAppFeedback


def _auth_headers(client: TestClient, username: str, password: str = "testpass123") -> dict[str, str]:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_submit_feedback(client: TestClient, test_user: User):
    headers = _auth_headers(client, test_user.username)
    r = client.post(
        "/api/v1/app-feedback",
        headers=headers,
        json={
            "rating": 5,
            "comment": "Juda qulay",
            "role": "picker",
            "module": "picking",
            "context_ref": "task-1",
            "app_version": "1.0.0",
            "platform": "android",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["rating"] == 5
    assert data["module"] == "picking"
    assert data["username"] == test_user.username


def test_submit_feedback_rate_limit(client: TestClient, test_user: User):
    headers = _auth_headers(client, test_user.username)
    payload = {
        "rating": 4,
        "role": "picker",
        "module": "picking",
    }
    r1 = client.post("/api/v1/app-feedback", headers=headers, json=payload)
    assert r1.status_code == 200
    r2 = client.post("/api/v1/app-feedback", headers=headers, json=payload)
    assert r2.status_code == 429


def test_list_feedback_requires_audit_read(client: TestClient, test_user: User, db_session: Session):
    from app.auth.security import get_password_hash

    picker = User(
        username="feedback_picker",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db_session.add(picker)
    db_session.add(
        UserAppFeedback(
            user_id=test_user.id,
            rating=3,
            comment="ok",
            role="picker",
            module="picking",
            created_at=datetime.now(timezone.utc),
        )
    )
    db_session.commit()
    db_session.refresh(picker)

    picker_headers = _auth_headers(client, picker.username)
    denied = client.get("/api/v1/app-feedback", headers=picker_headers)
    assert denied.status_code == 403

    admin_headers = _auth_headers(client, test_user.username)
    ok = client.get("/api/v1/app-feedback", headers=admin_headers)
    assert ok.status_code == 200
    body = ok.json()
    assert body["total"] >= 1
    assert body["stats"]["average_rating"] is not None
