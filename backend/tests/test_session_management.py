"""
Tests for single-device session management (hybrid approach)
"""
import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User


def test_login_creates_session_token(client: TestClient, db_session: Session, test_user: User):
    """Test that login creates and stores active session token"""
    response = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    
    # Verify session token is stored in database
    db_session.refresh(test_user)
    assert test_user.active_session_token == data["access_token"]
    assert test_user.session_started_at is not None
    assert test_user.last_device_info is not None


def test_second_login_invalidates_first_session(
    client: TestClient, 
    db_session: Session, 
    test_user: User
):
    """Test that logging in from second device invalidates first session"""
    # First login
    response1 = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"}
    )
    assert response1.status_code == 200
    token1 = response1.json()["access_token"]
    
    # Second login (simulating different device)
    response2 = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"},
        headers={"User-Agent": "Different Device"}
    )
    assert response2.status_code == 200
    token2 = response2.json()["access_token"]
    assert token1 != token2
    
    # Verify only token2 is active
    db_session.refresh(test_user)
    assert test_user.active_session_token == token2
    
    # First token should now be invalid
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token1}"}
    )
    assert response.status_code == 401
    assert "logged in from another device" in response.json()["detail"]
    
    # Second token should still work
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token2}"}
    )
    assert response.status_code == 200


def test_logout_clears_session(client: TestClient, db_session: Session, test_user: User):
    """Test that logout clears active session token"""
    # Login
    response = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"}
    )
    token = response.json()["access_token"]
    
    # Verify session is active
    db_session.refresh(test_user)
    assert test_user.active_session_token is not None
    
    # Logout
    response = client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    
    # Verify session is cleared
    db_session.refresh(test_user)
    assert test_user.active_session_token is None
    assert test_user.session_started_at is None


def test_device_info_stored(client: TestClient, db_session: Session, test_user: User):
    """Test that device info (user-agent) is stored on login"""
    custom_user_agent = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)"
    response = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"},
        headers={"User-Agent": custom_user_agent}
    )
    assert response.status_code == 200
    
    db_session.refresh(test_user)
    assert custom_user_agent in test_user.last_device_info


def test_multiple_users_independent_sessions(
    client: TestClient, 
    db_session: Session, 
    test_user: User
):
    """Test that different users can have active sessions independently"""
    # Create second user
    from app.auth.security import get_password_hash
    user2 = User(
        username="testuser2",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True
    )
    db_session.add(user2)
    db_session.commit()
    
    # Both users login
    response1 = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"}
    )
    token1 = response1.json()["access_token"]
    
    response2 = client.post(
        "/api/v1/auth/login",
        json={"username": "testuser2", "password": "testpass123"}
    )
    token2 = response2.json()["access_token"]
    
    # Both tokens should work
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token1}"}
    )
    assert response.status_code == 200
    assert response.json()["username"] == test_user.username
    
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token2}"}
    )
    assert response.status_code == 200
    assert response.json()["username"] == "testuser2"


def test_session_persists_across_requests(
    client: TestClient, 
    test_user: User
):
    """Test that a valid session works for multiple API calls"""
    # Login
    response = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"}
    )
    token = response.json()["access_token"]
    
    # Make multiple requests with same token
    for _ in range(5):
        response = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200


def test_no_session_token_allows_first_login(
    client: TestClient, 
    db_session: Session,
    test_user: User
):
    """Test that user without active session can login normally"""
    # Ensure no active session
    test_user.active_session_token = None
    test_user.session_started_at = None
    db_session.commit()
    
    # Login should work
    response = client.post(
        "/api/v1/auth/login",
        json={"username": test_user.username, "password": "testpass123"}
    )
    assert response.status_code == 200
    assert "access_token" in response.json()
