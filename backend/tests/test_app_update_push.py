"""Ilova yangilanishi push'i: standart matn ikki tilda (o'zbek + rus).

Broadcast hamma qurilmaga bir xil ketadi, xodim tili server'da ma'lum emas —
shuning uchun standart matnning o'zi ikki tilda bo'lishi kerak.
"""
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1.endpoints import notifications as notif_mod
from tests.test_sale_expiry_cutoff import _as, _clear, _mk_user


def _capture_broadcast(monkeypatch):
    sent: dict = {}

    def fake_broadcast(db, title, body, data=None):
        sent.update({"title": title, "body": body, "data": data or {}})
        return 3, 3, 0

    monkeypatch.setattr(notif_mod, "send_push_broadcast", fake_broadcast)
    return sent


def test_app_update_default_text_is_bilingual(client: TestClient, db_session: Session, monkeypatch):
    sent = _capture_broadcast(monkeypatch)
    _as(_mk_user(db_session, "warehouse_admin"))
    try:
        res = client.post("/api/v1/notifications/app-update", json={})
        assert res.status_code == 200, res.text
    finally:
        _clear()

    assert "Ilova yangilandi" in sent["title"]
    assert "Приложение обновлено" in sent["title"]
    uz, ru = sent["body"].split("\n")
    assert uz.startswith("Yangi versiya")
    assert ru.startswith("Вышла новая версия")
    assert sent["data"]["type"] == "app_update"


def test_app_update_custom_text_kept_verbatim(client: TestClient, db_session: Session, monkeypatch):
    """Admin o'z matnini bersa — unga tegilmaydi (ikki tilga majburlanmaydi)."""
    sent = _capture_broadcast(monkeypatch)
    _as(_mk_user(db_session, "warehouse_admin"))
    try:
        res = client.post(
            "/api/v1/notifications/app-update",
            json={"title": "Test sarlavha", "body": "Test matn"},
        )
        assert res.status_code == 200, res.text
    finally:
        _clear()

    assert sent["title"] == "Test sarlavha"
    assert sent["body"] == "Test matn"
