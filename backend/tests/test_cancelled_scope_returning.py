"""Qaytim jarayonidagi buyurtma "Bekor qilingan" tabida ko'rinishi.

Admin arxivdan "Qaytim (bekor)" bosgach, mollar joyiga qaytarilgunicha hujjat
`cancelling` holatida turadi. Ilgari u hech qaysi ro'yxatga tushmasdi.
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from tests.test_archive_revert_return import _complete_order_via_controller
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def _cancelled_scope_rows(client: TestClient) -> list[dict]:
    res = client.get(
        "/api/v1/picking/documents",
        params={"process_scope": "cancelled", "limit": 200},
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_returning_order_appears_in_cancelled_scope(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _complete_order_via_controller(client, db_session, order, picker)
    admin = _mk_user(db_session, username=f"adm-ret-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        # Qaytim boshlanmasdan oldin — "Bekor qilingan" ro'yxatida yo'q.
        before = _cancelled_scope_rows(client)
        assert all(r["id"] != str(doc_id) for r in before)

        cancel = client.patch(f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"})
        assert cancel.status_code == 200, cancel.text
        assert cancel.json()["status"] == "cancelling_in_progress"

        after = _cancelled_scope_rows(client)
        row = next((r for r in after if r["id"] == str(doc_id)), None)
        assert row is not None, "qaytim jarayonidagi hujjat ro'yxatda yo'q"
        assert row["order_wms_status"] == "cancelling_in_progress"
        # Bekor qilish hali tugamagan — vaqt yo'q, lekin kim boshlagani ma'lum.
        assert row["cancelled_at"] is None
        assert row["cancelled_by_user_name"] == (admin.full_name or admin.username)

        # Arxivda endi ko'rinmaydi (hujjat holati `cancelling`).
        archived = client.get(
            "/api/v1/picking/documents",
            params={"process_scope": "archived", "limit": 200},
        )
        assert archived.status_code == 200, archived.text
        assert all(r["id"] != str(doc_id) for r in archived.json())
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_finished_return_stays_in_cancelled_scope(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    doc_id = _complete_order_via_controller(client, db_session, order, picker)
    admin = _mk_user(db_session, username=f"adm-fin-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        cancel = client.patch(f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"})
        assert cancel.status_code == 200, cancel.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        mine = client.get("/api/v1/picking/return-session/mine")
        assert mine.status_code == 200 and mine.json() is not None, mine.text
        session_id = mine.json()["id"]
        for sl in mine.json()["lines"]:
            assert (
                client.post(
                    f"/api/v1/picking/return-session/{session_id}/scan-location",
                    json={"raw": sl["expected_location_code"]},
                ).status_code
                == 200
            )
            assert (
                client.post(
                    f"/api/v1/picking/return-session/{session_id}/scan-product",
                    json={"raw": sl.get("barcode") or sl.get("sku") or ""},
                ).status_code
                == 200
            )
        finish = client.post(f"/api/v1/picking/return-session/{session_id}/finish")
        assert finish.status_code == 200, finish.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        rows = _cancelled_scope_rows(client)
        row = next((r for r in rows if r["id"] == str(doc_id)), None)
        assert row is not None, "yakunlangan qaytim ro'yxatdan tushib qolgan"
        assert row["order_wms_status"] == "cancelled"
        assert row["cancelled_at"] is not None
    finally:
        app.dependency_overrides.pop(get_current_user, None)
