"""Bekor qilingan buyurtmadagi terish ishi ish haqi uchun ko'rinishi.

Bekor qilinganda qator `picked_qty` nolga tushadi — asosiy statistika bu ishni
yo'qotadi. Bu yerdagi hisob qaytarish sessiyasidan olinadi va o'sha ishni saqlab
qoladi, lekin unumdorlikka aralashmaydi.
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from tests.test_archive_revert_return import _complete_order_via_controller
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def _cancelled_rows(client: TestClient, **params) -> list[dict]:
    res = client.get("/api/v1/dashboard/staff-cancelled-stats", params=params)
    assert res.status_code == 200, res.text
    return res.json()["pickers"]


def _row_for(rows: list[dict], user_id) -> dict | None:
    return next((r for r in rows if r["user_id"] == str(user_id)), None)


def test_cancelled_pick_work_is_kept_for_payroll(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    _complete_order_via_controller(client, db_session, order, picker)
    admin = _mk_user(db_session, username=f"adm-cs-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        before = _row_for(_cancelled_rows(client), picker.id)
        assert before is None, "bekor qilinmasdan oldin qator bo'lmasligi kerak"

        cancel = client.patch(f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"})
        assert cancel.status_code == 200, cancel.text

        row = _row_for(_cancelled_rows(client), picker.id)
        assert row is not None, "terilgan ish yo'qolib ketdi"
        assert row["documents_count"] == 1
        assert row["positions"] >= 1
        assert row["qty"] > 0
        # Qaytarish hali bajarilmagan — operativ ko'rsatkich.
        assert row["pending_returns"] == 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_work_survives_after_the_return_is_finished(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    _complete_order_via_controller(client, db_session, order, picker)
    admin = _mk_user(db_session, username=f"adm-cf-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        assert (
            client.patch(
                f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"}
            ).status_code
            == 200
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        mine = client.get("/api/v1/picking/return-session/mine")
        session_id = mine.json()["id"]
        for sl in mine.json()["lines"]:
            client.post(
                f"/api/v1/picking/return-session/{session_id}/scan-location",
                json={"raw": sl["expected_location_code"]},
            )
            client.post(
                f"/api/v1/picking/return-session/{session_id}/scan-product",
                json={"raw": sl.get("barcode") or sl.get("sku") or ""},
            )
        assert client.post(f"/api/v1/picking/return-session/{session_id}/finish").status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        row = _row_for(_cancelled_rows(client), picker.id)
        assert row is not None
        assert row["positions"] >= 1
        assert row["qty"] > 0
        # Qaytarish tugadi — osilib qolgani yo'q.
        assert row["pending_returns"] == 0
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_cancelled_work_stays_out_of_productivity(
    client: TestClient, db_session: Session
) -> None:
    """Asosiy statistika bekor qilingan ishni sanamasligi kerak (unumdorlik buzilmasin)."""
    order, picker = _seed_allocatable_order(db_session)
    _complete_order_via_controller(client, db_session, order, picker)
    admin = _mk_user(db_session, username=f"adm-cp-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        timing_before = client.get("/api/v1/dashboard/staff-timing")
        assert timing_before.status_code == 200
        picked_before = next(
            (p for p in timing_before.json()["pickers"] if p["user_id"] == str(picker.id)),
            None,
        )
        assert picked_before is not None, "yakunlangan ish statistikada bo'lishi kerak"

        assert (
            client.patch(
                f"/api/v1/orders/{order.id}/status", json={"status": "cancelled"}
            ).status_code
            == 200
        )

        timing_after = client.get("/api/v1/dashboard/staff-timing")
        picked_after = next(
            (p for p in timing_after.json()["pickers"] if p["user_id"] == str(picker.id)),
            None,
        )
        if picked_after is not None:
            assert picked_after["total_positions"] < picked_before["total_positions"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_date_range_is_validated(client: TestClient, db_session: Session) -> None:
    admin = _mk_user(db_session, username=f"adm-cd-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.get(
            "/api/v1/dashboard/staff-cancelled-stats",
            params={"date_from": "2026-03-20", "date_to": "2026-03-19"},
        )
        assert res.status_code == 400, res.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)
