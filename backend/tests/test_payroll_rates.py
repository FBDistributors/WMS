"""Ish haqi tariflari va davr hisobidagi shahar/viloyat ajratmasi."""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from tests.test_my_stats_roles import _send_and_pick
from tests.test_order_transition_policy import _mk_user, _seed_allocatable_order


def _rates(client: TestClient) -> dict[tuple[str, str], float]:
    res = client.get("/api/v1/payroll-rates")
    assert res.status_code == 200, res.text
    return {(r["role"], r["source_group"]): r["amount"] for r in res.json()["rates"]}


def test_default_rates_are_served(client: TestClient, db_session: Session) -> None:
    admin = _mk_user(db_session, username=f"adm-pr-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        rates = _rates(client)
        assert rates[("picker", "shahar")] == 463
        assert rates[("picker", "region")] == 1389
        assert rates[("controller", "shahar")] == 278
        assert rates[("controller", "region")] == 834
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_admin_can_change_a_rate(client: TestClient, db_session: Session) -> None:
    admin = _mk_user(db_session, username=f"adm-pu-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.put(
            "/api/v1/payroll-rates",
            json={"rates": [{"role": "picker", "source_group": "shahar", "amount": 500}]},
        )
        assert res.status_code == 200, res.text
        assert _rates(client)[("picker", "shahar")] == 500

        bad = client.put(
            "/api/v1/payroll-rates",
            json={"rates": [{"role": "nobody", "source_group": "shahar", "amount": 1}]},
        )
        assert bad.status_code == 400, bad.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_period_splits_by_group_and_prices_the_work(
    client: TestClient, db_session: Session
) -> None:
    order, picker = _seed_allocatable_order(db_session)
    _send_and_pick(client, db_session, order, picker)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        body = client.get("/api/v1/picking/my-period-stats").json()
        assert body["rate_shahar"] > 0 and body["rate_region"] > 0

        totals = body["totals"]
        # Seed buyurtmasi `test` manbasidan — viloyat emas, ya'ni shahar guruhi.
        assert totals["shahar"]["orders"] >= 1
        assert totals["region"]["orders"] == 0
        assert totals["orders"] == totals["shahar"]["orders"] + totals["region"]["orders"]

        # Ball = pozitsiya soni x tarif (buyurtma soni emas).
        assert totals["shahar"]["amount"] == totals["shahar"]["positions"] * body["rate_shahar"]
        assert totals["amount"] == totals["shahar"]["amount"] + totals["region"]["amount"]

        day = body["days"][0]
        assert day["orders"] == day["shahar"]["orders"] + day["region"]["orders"]
        assert day["amount"] == day["shahar"]["amount"] + day["region"]["amount"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_a_rate_change_leaves_past_periods_alone(
    client: TestClient, db_session: Session
) -> None:
    """Yangi tarif joriy davrdan boshlanadi: to'langan oy o'z tarifida qoladi."""
    order, picker = _seed_allocatable_order(db_session)
    _send_and_pick(client, db_session, order, picker)
    admin = _mk_user(db_session, username=f"adm-rc-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        before = client.get("/api/v1/picking/my-period-stats").json()
        prev_before = client.get(
            "/api/v1/picking/my-period-stats", params={"offset": -1}
        ).json()
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.put(
            "/api/v1/payroll-rates",
            json={"rates": [{"role": "picker", "source_group": "shahar", "amount": 1000}]},
        )
        assert res.status_code == 200, res.text
        assert res.json()["effective_from"] == before["period_from"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        after = client.get("/api/v1/picking/my-period-stats").json()
        prev_after = client.get("/api/v1/picking/my-period-stats", params={"offset": -1}).json()

        # Joriy davr yangi tarifda.
        assert after["rate_shahar"] == 1000
        assert after["totals"]["amount"] > before["totals"]["amount"]

        # Oldingi davr tegilmagan — eski tarif o'z joyida.
        assert prev_after["rate_shahar"] == prev_before["rate_shahar"] == 463
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_points_follow_positions_not_orders(client: TestClient, db_session: Session) -> None:
    """Ikki qatorli bitta buyurtma: ball qator soniga qarab ikki barobar bo'lsin."""
    from app.models.document import Document, DocumentLine

    order, picker = _seed_allocatable_order(db_session)
    doc_id = _send_and_pick(client, db_session, order, picker)

    doc = db_session.query(Document).filter(Document.id == uuid.UUID(doc_id)).one()
    first = db_session.query(DocumentLine).filter(DocumentLine.document_id == doc.id).first()
    db_session.add(
        DocumentLine(
            document_id=doc.id,
            product_id=first.product_id,
            lot_id=first.lot_id,
            location_id=first.location_id,
            sku=first.sku,
            product_name=first.product_name,
            location_code=first.location_code,
            required_qty=first.required_qty,
            picked_qty=first.picked_qty,
        )
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        body = client.get("/api/v1/picking/my-period-stats").json()
        totals = body["totals"]["shahar"]
        assert totals["orders"] == 1
        assert totals["positions"] == 2, "ikkinchi qator hisobga tushmadi"
        assert totals["amount"] == 2 * body["rate_shahar"]
        assert totals["amount"] != totals["orders"] * body["rate_shahar"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
