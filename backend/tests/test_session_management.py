"""
Tests for session management: admin up to 3 devices, others 2 (mobil + boshqa).
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.user_session import UserSession
from app.auth.security import get_password_hash


def test_login_creates_session(client: TestClient, db_session: Session, test_user: User):
    """Login creates a UserSession row and sets last_device_info on user."""
    response = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    token = data["access_token"]
    db_session.refresh(test_user)
    assert test_user.last_device_info is not None
    session = (
        db_session.query(UserSession)
        .filter(UserSession.user_id == test_user.id, UserSession.token == token)
        .first()
    )
    assert session is not None


def test_non_admin_two_sessions_then_third_invalidates_oldest(
    client: TestClient, db_session: Session, test_user: User
):
    """Non-admin: can have 2 sessions (e.g. mobil + boshqa); 3rd login removes oldest."""
    picker = User(
        username="picker1",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db_session.add(picker)
    db_session.commit()
    db_session.refresh(picker)

    r1 = client.post(
        "/api/v1/auth/login",
        json={"username": picker.username, "password": "testpass123"},
    )
    assert r1.status_code == 200
    token1 = r1.json()["access_token"]
    r2 = client.post(
        "/api/v1/auth/login",
        json={"username": picker.username, "password": "testpass123"},
        headers={"User-Agent": "Other Device"},
    )
    assert r2.status_code == 200
    token2 = r2.json()["access_token"]
    assert token1 != token2

    # Both tokens valid (2 sessions allowed)
    resp1 = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token1}"})
    assert resp1.status_code == 200
    resp2 = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token2}"})
    assert resp2.status_code == 200

    # 3rd login: oldest (token1) invalidated
    r3 = client.post(
        "/api/v1/auth/login",
        json={"username": picker.username, "password": "testpass123"},
        headers={"User-Agent": "Third Device"},
    )
    assert r3.status_code == 200
    token3 = r3.json()["access_token"]
    resp_old = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token1}"})
    assert resp_old.status_code == 401
    resp_new = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token3}"})
    assert resp_new.status_code == 200


def test_admin_can_have_three_sessions(
    client: TestClient, db_session: Session, test_user: User
):
    """Admin (warehouse_admin) can have up to 3 concurrent sessions."""
    # test_user is warehouse_admin
    tokens = []
    for i in range(3):
        r = client.post(
            "/api/v1/auth/login",
            json={"username": test_user.username, "password": "testpass123"},
            headers={"User-Agent": f"Device-{i}"},
        )
        assert r.status_code == 200
        tokens.append(r.json()["access_token"])
    assert len(set(tokens)) == 3
    sessions = (
        db_session.query(UserSession).filter(UserSession.user_id == test_user.id).all()
    )
    assert len(sessions) == 3
    # All three tokens work
    for token in tokens:
        resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200

    # 4th login: oldest session removed, first token invalid
    r4 = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"},
        headers={"User-Agent": "Device-4"},
    )
    assert r4.status_code == 200
    token4 = r4.json()["access_token"]
    sessions_after = (
        db_session.query(UserSession).filter(UserSession.user_id == test_user.id).all()
    )
    assert len(sessions_after) == 3
    resp_old = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tokens[0]}"})
    assert resp_old.status_code == 401
    resp_new = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token4}"})
    assert resp_new.status_code == 200


def test_logout_clears_session(client: TestClient, db_session: Session, test_user: User):
    """Logout removes the session from user_sessions."""
    r = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"},
    )
    token = r.json()["access_token"]
    count_before = (
        db_session.query(UserSession).filter(UserSession.user_id == test_user.id).count()
    )
    assert count_before >= 1
    r = client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    count_after = (
        db_session.query(UserSession).filter(UserSession.user_id == test_user.id).count()
    )
    assert count_after == count_before - 1


def test_device_info_stored(client: TestClient, db_session: Session, test_user: User):
    """Device info (user-agent) is stored on user and in UserSession."""
    custom_user_agent = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)"
    r = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"},
        headers={"User-Agent": custom_user_agent},
    )
    assert r.status_code == 200
    db_session.refresh(test_user)
    assert custom_user_agent in (test_user.last_device_info or "")
    session = (
        db_session.query(UserSession)
        .filter(UserSession.user_id == test_user.id, UserSession.token == r.json()["access_token"])
        .first()
    )
    assert session is not None and custom_user_agent in (session.device_info or "")


def test_multiple_users_independent_sessions(
    client: TestClient, db_session: Session, test_user: User
):
    """Different users can have active sessions independently."""
    user2 = User(
        username="testuser2",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db_session.add(user2)
    db_session.commit()
    r1 = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"},
    )
    token1 = r1.json()["access_token"]
    r2 = client.post(
        "/api/v1/auth/login",
        json={"username": "testuser2", "password": "testpass123"},
    )
    token2 = r2.json()["access_token"]
    resp1 = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token1}"})
    assert resp1.status_code == 200
    assert resp1.json()["username"] == test_user.username
    resp2 = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token2}"})
    assert resp2.status_code == 200
    assert resp2.json()["username"] == "testuser2"


def test_session_persists_across_requests(
    client: TestClient, test_user: User
):
    """A valid session works for multiple API calls."""
    r = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"},
    )
    token = r.json()["access_token"]
    for _ in range(5):
        resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200


def test_no_session_allows_login(client: TestClient, db_session: Session, test_user: User):
    """User with no sessions can login normally."""
    db_session.query(UserSession).filter(UserSession.user_id == test_user.id).delete()
    test_user.active_session_token = None
    test_user.session_started_at = None
    db_session.commit()
    r = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"},
    )
    assert r.status_code == 200
    assert "access_token" in r.json()
