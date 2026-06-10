"""
Tests for login rate-limiting: 5 failed attempts within the window -> 429.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1.endpoints import auth as auth_endpoint
from app.models.user import User


@pytest.fixture(autouse=True)
def _clear_rate_limit_state():
    auth_endpoint._failed_login_attempts.clear()
    yield
    auth_endpoint._failed_login_attempts.clear()


def _login(client: TestClient, username: str, password: str):
    return client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )


def test_rate_limit_blocks_after_failed_attempts(client: TestClient, test_user: User):
    """After 5 wrong-password attempts the next attempt returns 429 even with the correct password."""
    for _ in range(auth_endpoint.LOGIN_MAX_FAILED_ATTEMPTS):
        r = _login(client, test_user.username, "wrong-password")
        assert r.status_code == 401

    r = _login(client, test_user.username, "testpass123")
    assert r.status_code == 429


def test_successful_login_clears_counter(client: TestClient, test_user: User):
    """A successful login before reaching the limit resets the failed-attempt counter."""
    for _ in range(auth_endpoint.LOGIN_MAX_FAILED_ATTEMPTS - 1):
        r = _login(client, test_user.username, "wrong-password")
        assert r.status_code == 401

    r = _login(client, test_user.username, "testpass123")
    assert r.status_code == 200

    # Counter cleared: a new wrong attempt is 401 (not 429)
    r = _login(client, test_user.username, "wrong-password")
    assert r.status_code == 401


def test_rate_limit_is_per_username(client: TestClient, test_user: User):
    """Blocking one username does not block another."""
    for _ in range(auth_endpoint.LOGIN_MAX_FAILED_ATTEMPTS):
        r = _login(client, "someone-else", "wrong-password")
        assert r.status_code == 401
    r = _login(client, "someone-else", "wrong-password")
    assert r.status_code == 429

    r = _login(client, test_user.username, "testpass123")
    assert r.status_code == 200


def test_rate_limit_expires_after_window(client: TestClient, test_user: User):
    """Old failed attempts outside the window no longer block login."""
    for _ in range(auth_endpoint.LOGIN_MAX_FAILED_ATTEMPTS):
        r = _login(client, test_user.username, "wrong-password")
        assert r.status_code == 401
    assert _login(client, test_user.username, "testpass123").status_code == 429

    # Simulate the window passing by aging the recorded timestamps
    shift = auth_endpoint.LOGIN_ATTEMPT_WINDOW_SECONDS + 1
    for key, attempts in auth_endpoint._failed_login_attempts.items():
        auth_endpoint._failed_login_attempts[key] = [t - shift for t in attempts]

    r = _login(client, test_user.username, "testpass123")
    assert r.status_code == 200
