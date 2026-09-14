"""Diller ombor qoldig'i sanovi: WMS ledgeridan alohida hujjatlar.

Kafolatlar: idempotent yuborish, faqat ruxsatli rollar, bo'sh hujjat yuborilmaydi,
yuborilgan hujjat o'zgarmaydi, skan serverda resolve bo'ladi, va eng muhimi —
sanov `stock_movements` ga hech narsa yozmaydi.
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.product import Product
from app.models.settings_organization import SettingsOrganization
from app.models.stock import StockMovement
from tests.test_sale_expiry_cutoff import _as, _clear, _mk_user

URL = "/api/v1/dealer-counts"


def _seed(db: Session):
    org = SettingsOrganization(org_id=f"81{uuid.uuid4().hex[:6]}", name="Дилер Test (Sinov)")
    head = SettingsOrganization(org_id="3788131", name="Головной Офис")
    product = Product(
        external_source="test",
        external_id=f"dc-{uuid.uuid4().hex[:8]}",
        name="Dealer Count Prod",
        sku=f"SKU-DC-{uuid.uuid4().hex[:6]}",
        barcode=f"46{uuid.uuid4().int % 10**11:011d}",
        is_active=True,
    )
    db.add_all([org, head, product])
    db.commit()
    db.refresh(org)
    db.refresh(product)
    return org, product


def _payload(org, product, *, submit=False, client_uuid=None, lines=None):
    return {
        "client_uuid": str(client_uuid or uuid.uuid4()),
        "dealer_org_id": org.org_id,
        "submit": submit,
        "lines": lines
        if lines is not None
        else [{"product_id": str(product.id), "scanned_barcode": product.barcode, "qty": 12}],
    }


def _movements(db: Session) -> int:
    return db.query(StockMovement).count()


def test_dealers_list_hides_head_office(client: TestClient, db_session: Session):
    org, _ = _seed(db_session)
    _as(_mk_user(db_session, "inventory_controller"))
    try:
        res = client.get(f"{URL}/dealers")
        assert res.status_code == 200, res.text
        ids = {d["org_id"] for d in res.json()}
        assert org.org_id in ids
        assert "3788131" not in ids
    finally:
        _clear()


def test_create_is_idempotent_by_client_uuid(client: TestClient, db_session: Session):
    org, product = _seed(db_session)
    _as(_mk_user(db_session, "inventory_controller"))
    try:
        cu = uuid.uuid4()
        a = client.post(URL, json=_payload(org, product, submit=True, client_uuid=cu))
        b = client.post(URL, json=_payload(org, product, submit=True, client_uuid=cu))
        assert a.status_code == 200, a.text
        assert b.status_code == 200, b.text
        assert a.json()["id"] == b.json()["id"]
        lst = client.get(URL, params={"dealer_org_id": org.org_id})
        assert lst.json()["total"] == 1
        assert a.json()["status"] == "submitted"
        assert a.json()["dealer_name"] == org.name
        assert a.json()["lines_count"] == 1
        assert float(a.json()["total_units"]) == 12
    finally:
        _clear()


def test_picker_cannot_create(client: TestClient, db_session: Session):
    org, product = _seed(db_session)
    _as(_mk_user(db_session, "picker"))
    try:
        res = client.post(URL, json=_payload(org, product))
        assert res.status_code == 403, res.text
    finally:
        _clear()


def test_submit_empty_rejected_and_submitted_is_frozen(client: TestClient, db_session: Session):
    org, product = _seed(db_session)
    _as(_mk_user(db_session, "inventory_controller"))
    try:
        empty = client.post(URL, json=_payload(org, product, lines=[]))
        assert empty.status_code == 200, empty.text
        cid = empty.json()["id"]
        assert client.post(f"{URL}/{cid}/submit").status_code == 400

        upd = client.put(
            f"{URL}/{cid}",
            json={"lines": [{"product_id": str(product.id), "scanned_barcode": "", "qty": 3}]},
        )
        assert upd.status_code == 200, upd.text
        assert client.post(f"{URL}/{cid}/submit").status_code == 200

        assert client.put(f"{URL}/{cid}", json={"lines": []}).status_code == 409
        # Yuborilganni faqat admin o'chiradi — egasi ham emas.
        assert client.delete(f"{URL}/{cid}").status_code == 403
    finally:
        _clear()


def test_admin_can_delete_submitted(client: TestClient, db_session: Session):
    org, product = _seed(db_session)
    _as(_mk_user(db_session, "warehouse_admin"))
    try:
        cid = client.post(URL, json=_payload(org, product, submit=True)).json()["id"]
        assert client.delete(f"{URL}/{cid}").status_code == 204
        assert client.get(f"{URL}/{cid}").status_code == 404
    finally:
        _clear()


def test_barcode_resolved_server_side_and_lines_merged(client: TestClient, db_session: Session):
    org, product = _seed(db_session)
    _as(_mk_user(db_session, "inventory_controller"))
    try:
        res = client.post(
            URL,
            json=_payload(
                org,
                product,
                lines=[
                    {"scanned_barcode": product.barcode, "qty": 5, "expiry_date": "2027-03-15"},
                    {"scanned_barcode": product.barcode, "qty": 7, "expiry_date": "2027-03-01"},
                    {"scanned_barcode": "0000000000000", "qty": 1},
                ],
            ),
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["lines_count"] == 2
        by_sku = {ln["sku"]: ln for ln in body["lines"]}
        merged = by_sku[product.sku]
        assert float(merged["qty"]) == 12
        assert merged["expiry_date"] == "2027-03-01"  # oy boshiga normallashadi
        unknown = by_sku[None]
        assert unknown["product_id"] is None
        assert unknown["scanned_barcode"] == "0000000000000"
    finally:
        _clear()


def test_count_never_touches_stock_ledger(client: TestClient, db_session: Session):
    org, product = _seed(db_session)
    _as(_mk_user(db_session, "warehouse_admin"))
    try:
        before = _movements(db_session)
        res = client.post(URL, json=_payload(org, product, submit=True))
        assert res.status_code == 200, res.text
        assert _movements(db_session) == before
    finally:
        _clear()


def test_other_user_cannot_edit_but_admin_can(client: TestClient, db_session: Session):
    org, product = _seed(db_session)
    owner = _mk_user(db_session, "inventory_controller")
    other = _mk_user(db_session, "inventory_controller")
    admin = _mk_user(db_session, "warehouse_admin")
    _as(owner)
    try:
        cid = client.post(URL, json=_payload(org, product)).json()["id"]
    finally:
        _clear()
    _as(other)
    try:
        assert client.delete(f"{URL}/{cid}").status_code == 403
    finally:
        _clear()
    _as(admin)
    try:
        assert client.delete(f"{URL}/{cid}").status_code == 204
    finally:
        _clear()


def test_export_xlsx(client: TestClient, db_session: Session):
    org, product = _seed(db_session)
    _as(_mk_user(db_session, "inventory_controller"))
    try:
        cid = client.post(URL, json=_payload(org, product, submit=True)).json()["id"]
        res = client.get(f"{URL}/{cid}/export.xlsx")
        assert res.status_code == 200, res.text
        assert res.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        from io import BytesIO

        from openpyxl import load_workbook

        ws = load_workbook(BytesIO(res.content)).active
        rows = list(ws.iter_rows(values_only=True))
        header_idx = next(i for i, r in enumerate(rows) if r and r[0] == "#")
        assert rows[header_idx + 1][1] == product.sku
        assert rows[header_idx + 1][4] == 12
    finally:
        _clear()
