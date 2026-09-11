"""Diller sanovi ↔ Smartup qoldig'i solishtiruvi.

Smartup so'rovi monkeypatch bilan almashtiriladi: tarmoqqa chiqilmaydi.
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.product import Product
from app.models.settings_organization import SettingsOrganization
from app.services import dealer_count_compare as cmp
from tests.test_sale_expiry_cutoff import _as, _clear, _mk_user

URL = "/api/v1/dealer-counts"


def test_aggregate_and_rows_pure():
    smartup = cmp.aggregate_balance_by_sku(
        [
            {"product_code": "A", "quantity": "7", "batch_number": "b1"},
            {"product_code": "A", "quantity": "3", "batch_number": "b2"},
            {"product_code": "B", "quantity": "5"},
            {"product_code": "", "quantity": "99"},
        ]
    )
    assert smartup == {"A": 10.0, "B": 5.0}
    rows = cmp.build_compare_rows({"A": 12.0, "C": 1.0}, smartup, {"A": "Prod A"})
    by = {r["sku"]: r for r in rows}
    assert by["A"]["diff"] == 2.0 and by["A"]["only_in"] is None
    assert by["B"]["counted"] == 0 and by["B"]["only_in"] == "smartup"
    assert by["C"]["smartup"] == 0 and by["C"]["only_in"] == "count"
    # Katta farq yuqorida
    assert rows[0]["sku"] == "B"


def _seed(db: Session, *, wh: str | None):
    org = SettingsOrganization(org_id=f"30{uuid.uuid4().hex[:6]}", name="Дилер Cmp", smartup_warehouse_code=wh)
    a = Product(external_source="t", external_id=f"a-{uuid.uuid4().hex[:6]}", name="Prod A", sku=f"A-{uuid.uuid4().hex[:5]}", is_active=True)
    b = Product(external_source="t", external_id=f"b-{uuid.uuid4().hex[:6]}", name="Prod B", sku=f"B-{uuid.uuid4().hex[:5]}", is_active=True)
    db.add_all([org, a, b])
    db.commit()
    for x in (org, a, b):
        db.refresh(x)
    return org, a, b


def _create_count(client: TestClient, org, a) -> str:
    res = client.post(
        URL,
        json={
            "client_uuid": str(uuid.uuid4()),
            "dealer_org_id": org.org_id,
            "submit": True,
            "lines": [
                {"product_id": str(a.id), "qty": 8, "expiry_date": "2027-01-01"},
                {"product_id": str(a.id), "qty": 4, "expiry_date": "2027-06-01"},
                {"scanned_barcode": "0000000000000", "qty": 2},
            ],
        },
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_compare_requires_warehouse_code(client: TestClient, db_session: Session):
    org, a, _ = _seed(db_session, wh=None)
    _as(_mk_user(db_session, "warehouse_admin"))
    try:
        cid = _create_count(client, org, a)
        res = client.get(f"{URL}/{cid}/compare")
        assert res.status_code == 400
        assert "ombor kodi" in res.text
    finally:
        _clear()


def test_compare_merges_expiry_rows_and_flags_missing(client: TestClient, db_session: Session, monkeypatch):
    org, a, b = _seed(db_session, wh="wh30")
    calls: list = []

    def fake_fetch(fid, wh):
        calls.append((fid, wh))
        return {"balance": [
            {"product_code": a.sku, "quantity": "7", "batch_number": "x"},
            {"product_code": a.sku, "quantity": "3", "batch_number": "y"},
            {"product_code": b.sku, "quantity": "5"},
        ]}

    monkeypatch.setattr(cmp, "fetch_balance_from_smartup", fake_fetch)
    monkeypatch.setattr(cmp, "read_balance_cache", lambda *a, **k: None)
    monkeypatch.setattr(cmp, "write_balance_cache", lambda *a, **k: None)

    _as(_mk_user(db_session, "warehouse_admin"))
    try:
        cid = _create_count(client, org, a)
        res = client.get(f"{URL}/{cid}/compare")
        assert res.status_code == 200, res.text
        body = res.json()
    finally:
        _clear()

    assert calls == [(org.org_id, "wh30")]
    assert body["source"] == "live"
    assert body["unknown_lines"] == 1  # tanilmagan skan solishtirilmaydi
    by = {r["sku"]: r for r in body["rows"]}
    assert by[a.sku]["counted"] == 12 and by[a.sku]["smartup"] == 10 and by[a.sku]["diff"] == 2
    assert by[b.sku]["counted"] == 0 and by[b.sku]["only_in"] == "smartup"
    assert by[b.sku]["product_name"] == "Prod B"
    assert body["totals"]["counted"] == 12 and body["totals"]["smartup"] == 15
    assert body["totals"]["only_in_smartup"] == 1
