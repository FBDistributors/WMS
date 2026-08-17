"""users.person_code: profillarni shaxsga bog'lash maydoni (to'rt ko'z qoidasi asosi)."""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.user import User


def _mk_admin(db: Session) -> User:
    admin = User(
        username=f"adm-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def _override(user: User):
    app.dependency_overrides[get_current_user] = lambda: user


def _clear():
    app.dependency_overrides.pop(get_current_user, None)


# Eslatma: POST /users endpointi PostgreSQL sequence (user_code_seq) ishlatadi va
# SQLite test muhitida ishlamaydi (oldindan mavjud cheklov). Shuning uchun create
# yo'lidagi normalizatsiya helper darajasida, qolgani PATCH orqali tekshiriladi —
# ikkalasi ham bitta _normalize_person_code dan o'tadi.


def test_normalize_person_code():
    from app.api.v1.endpoints.users import _normalize_person_code

    assert _normalize_person_code("  X-012  ") == "X-012"
    assert _normalize_person_code("") is None
    assert _normalize_person_code("   ") is None
    assert _normalize_person_code(None) is None


def test_update_user_set_and_clear_person_code(client: TestClient, db_session: Session):
    admin = _mk_admin(db_session)
    target = User(
        username=f"ctrl-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="controller",
        is_active=True,
    )
    db_session.add(target)
    db_session.commit()
    db_session.refresh(target)

    _override(admin)
    try:
        set_resp = client.patch(f"/api/v1/users/{target.id}", json={"person_code": "X-012"})
        assert set_resp.status_code == 200
        assert set_resp.json()["person_code"] == "X-012"

        clear_resp = client.patch(f"/api/v1/users/{target.id}", json={"person_code": ""})
        assert clear_resp.status_code == 200
        assert clear_resp.json()["person_code"] is None
    finally:
        _clear()

    db_session.refresh(target)
    assert target.person_code is None


def test_update_without_person_code_leaves_it_untouched(client: TestClient, db_session: Session):
    admin = _mk_admin(db_session)
    target = User(
        username=f"ctrl-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="controller",
        person_code="X-777",
        is_active=True,
    )
    db_session.add(target)
    db_session.commit()
    db_session.refresh(target)

    _override(admin)
    try:
        resp = client.patch(f"/api/v1/users/{target.id}", json={"full_name": "Yangi Ism"})
    finally:
        _clear()
    assert resp.status_code == 200
    assert resp.json()["person_code"] == "X-777"
