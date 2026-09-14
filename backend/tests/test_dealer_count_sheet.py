"""Diller sanovi — ro'yxat (ведомость) va telefondan sanash (holatsiz).

prefill (manbalar, snapshot, takror), bir necha xodim bir vaqtda sanaydi, qator joyi
(javon/zona), kech kelgan eski qiymat yangisini bosib ketmaydi, yopilgan sanovga ham yoziladi,
solishtiruv joylar bo'yicha jamlanadi. Smartup so'rovi monkeypatch — tarmoqqa chiqilmaydi.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.order import Order, OrderLine, OrderWmsState
from app.models.product import Product
from app.models.settings_organization import SettingsOrganization
from app.services import dealer_count_compare as cmp
from app.services import dealer_count_sheet as sheet
from tests.test_sale_expiry_cutoff import _as, _clear, _mk_user

URL = "/api/v1/dealer-counts"


def _product(db: Session, tag: str) -> Product:
    p = Product(
        external_source="t",
        external_id=f"{tag}-{uuid.uuid4().hex[:6]}",
        name=f"Prod {tag}",
        sku=f"{tag}-{uuid.uuid4().hex[:5]}",
        barcode=f"46{uuid.uuid4().int % 10**11:011d}",
        is_active=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _org(db: Session, *, wh: str | None) -> SettingsOrganization:
    org = SettingsOrganization(org_id=f"30{uuid.uuid4().hex[:6]}", name="Дилер Sheet", smartup_warehouse_code=wh)
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def _patch_smartup(monkeypatch, balance: dict[str, float]):
    monkeypatch.setattr(sheet, "load_dealer_balance", lambda db, org_id, refresh=False: (dict(balance), "cache", "wh30"))
    monkeypatch.setattr(cmp, "load_dealer_balance", lambda db, org_id, refresh=False: (dict(balance), "cache", "wh30"))


def _sheet(client: TestClient, db_session: Session, org, balance_skus: list[str]) -> str:
    """Admin sanov yaratib Smartup'dan to'ldiradi. Chaqiruvchi monkeypatch qilgan bo'lishi kerak."""
    _as(_mk_user(db_session, "warehouse_admin"))
    try:
        res = client.post(URL, json={"client_uuid": str(uuid.uuid4()), "dealer_org_id": org.org_id, "lines": []})
        assert res.status_code == 200, res.text
        cid = res.json()["id"]
        r = client.post(f"{URL}/{cid}/prefill", json={"sources": ["smartup"]})
        assert r.status_code == 200, r.text
        assert r.json()["added"] == len(balance_skus)
        return cid
    finally:
        _clear()


def _at(minutes_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


# --- prefill -----------------------------------------------------------------


def test_prefill_smartup_adds_snapshot_and_skips_duplicates(client: TestClient, db_session: Session, monkeypatch):
    org = _org(db_session, wh="wh30")
    a, b = _product(db_session, "A"), _product(db_session, "B")
    _patch_smartup(monkeypatch, {a.sku: 10, b.sku: 5, "NOT-IN-CATALOG": 3})
    _as(_mk_user(db_session, "warehouse_admin"))
    try:
        cid = client.post(URL, json={"client_uuid": str(uuid.uuid4()), "dealer_org_id": org.org_id}).json()["id"]
        r1 = client.post(f"{URL}/{cid}/prefill", json={"sources": ["smartup"]})
        assert (r1.json()["added"], r1.json()["skipped"], r1.json()["not_in_catalog"]) == (2, 0, 1)
        c = r1.json()["count"]
        assert c["source"] == "sheet" and c["sheet_lines"] == 2 and c["counted_lines"] == 0
        by = {ln["sku"]: ln for ln in c["lines"]}
        assert by[a.sku]["qty"] is None and float(by[a.sku]["snapshot_qty"]) == 10
        r2 = client.post(f"{URL}/{cid}/prefill", json={"sources": ["smartup"]})
        assert (r2.json()["added"], r2.json()["skipped"]) == (0, 2)
    finally:
        _clear()


def test_prefill_falls_back_to_shipped_without_warehouse_code(client: TestClient, db_session: Session):
    org = _org(db_session, wh=None)
    x = _product(db_session, "X")
    order = Order(source="diller", source_external_id=f"d-{uuid.uuid4().hex[:8]}", order_number=f"D-{uuid.uuid4().hex[:6]}", to_filial_code=org.org_id)
    order.wms_state = OrderWmsState(status="completed")
    order.lines = [OrderLine(sku=x.sku, name="X line", qty=3.0, uom="dona")]
    db_session.add(order)
    db_session.commit()
    _as(_mk_user(db_session, "warehouse_admin"))
    try:
        cid = client.post(URL, json={"client_uuid": str(uuid.uuid4()), "dealer_org_id": org.org_id}).json()["id"]
        r = client.post(f"{URL}/{cid}/prefill", json={"sources": ["smartup"]})
        assert r.status_code == 200, r.text
        assert r.json()["sources"] == ["shipped"] and r.json()["added"] == 1
    finally:
        _clear()


def test_counter_cannot_prefill(client: TestClient, db_session: Session, monkeypatch):
    org = _org(db_session, wh="wh30")
    a = _product(db_session, "A")
    _patch_smartup(monkeypatch, {a.sku: 1})
    cid = _sheet(client, db_session, org, [a.sku])
    _as(_mk_user(db_session, "inventory_controller"))
    try:
        assert client.post(f"{URL}/{cid}/prefill", json={"sources": ["smartup"]}).status_code == 403
    finally:
        _clear()


# --- telefondan sanash --------------------------------------------------------


def test_two_workers_count_same_sheet_with_locations(client: TestClient, db_session: Session, monkeypatch):
    """Qulf yo'q: ikki xodim bir ro'yxatni sanaydi; bir tovar ikki joyda — ikki qator."""
    org = _org(db_session, wh="wh30")
    a, b = _product(db_session, "A"), _product(db_session, "B")
    _patch_smartup(monkeypatch, {a.sku: 10, b.sku: 5})
    cid = _sheet(client, db_session, org, [a.sku, b.sku])
    u1, u2 = _mk_user(db_session, "inventory_controller"), _mk_user(db_session, "inventory_controller")
    _as(u1)
    try:
        # Ro'yxatdagi sanalmagan qator birinchi sanashda joyni oladi.
        r = client.put(f"{URL}/{cid}/counts", json={"entries": [{"product_id": str(a.id), "qty": 4, "location_code": "a-1"}]})
        assert r.status_code == 200 and (r.json()["updated"], r.json()["added"]) == (1, 0)
    finally:
        _clear()
    _as(u2)
    try:
        # Shu tovar boshqa javonda — yangi qator; b ni ham sanaydi.
        r = client.put(
            f"{URL}/{cid}/counts",
            json={"entries": [
                {"product_id": str(a.id), "qty": 3, "location_code": "B-2"},
                {"product_id": str(b.id), "qty": 0},
            ]},
        )
        assert (r.json()["updated"], r.json()["added"]) == (1, 1)
        c = r.json()["count"]
        a_lines = sorted((ln["location_code"], float(ln["qty"])) for ln in c["lines"] if ln["sku"] == a.sku)
        assert a_lines == [("A-1", 4.0), ("B-2", 3.0)]
        assert c["sheet_lines"] == 3 and c["counted_lines"] == 3 and float(c["total_units"]) == 7
        assert c["last_counted_by_name"]
        # Idempotent: takror yuborish qiymatni o'zgartirmaydi va qator qo'shmaydi.
        again = client.put(f"{URL}/{cid}/counts", json={"entries": [{"product_id": str(a.id), "qty": 3, "location_code": "B-2"}]})
        assert again.json()["added"] == 0 and again.json()["count"]["sheet_lines"] == 3
    finally:
        _clear()
    # Solishtiruv SKU bo'yicha jamlaydi (joylar yig'indisi).
    _as(u1)
    try:
        rows = {r["sku"]: r for r in client.get(f"{URL}/{cid}/compare").json()["rows"]}
        assert rows[a.sku]["counted"] == 7 and rows[a.sku]["diff"] == -3
        assert rows[b.sku]["counted"] == 0 and rows[b.sku]["is_counted"] is True
    finally:
        _clear()


def test_late_old_value_does_not_overwrite_newer(client: TestClient, db_session: Session, monkeypatch):
    """Oflayn telefon kech ulanib eski qiymatni yuborsa — yangi sanalgan qoladi."""
    org = _org(db_session, wh="wh30")
    a = _product(db_session, "A")
    _patch_smartup(monkeypatch, {a.sku: 10})
    cid = _sheet(client, db_session, org, [a.sku])
    _as(_mk_user(db_session, "inventory_controller"))
    try:
        new = client.put(f"{URL}/{cid}/counts", json={"entries": [{"product_id": str(a.id), "qty": 9, "counted_at": _at(1)}]})
        line_id = new.json()["count"]["lines"][0]["id"]
        old = client.put(f"{URL}/{cid}/counts", json={"entries": [{"line_id": line_id, "product_id": str(a.id), "qty": 2, "counted_at": _at(30)}]})
        assert old.json()["stale"] == 1
        assert float(old.json()["count"]["lines"][0]["qty"]) == 9
        newer = client.put(f"{URL}/{cid}/counts", json={"entries": [{"line_id": line_id, "product_id": str(a.id), "qty": 8}]})
        assert newer.json()["stale"] == 0 and float(newer.json()["count"]["lines"][0]["qty"]) == 8
    finally:
        _clear()


def test_closed_sheet_still_accepts_late_counts(client: TestClient, db_session: Session, monkeypatch):
    """Yangi sanov eskisini yopgach ham, oflayn telefonning kech kelgan sanalgani yoziladi."""
    org = _org(db_session, wh="wh30")
    a = _product(db_session, "A")
    _patch_smartup(monkeypatch, {a.sku: 1})
    cid = _sheet(client, db_session, org, [a.sku])
    _as(_mk_user(db_session, "warehouse_admin"))
    try:
        client.post(URL, json={"client_uuid": str(uuid.uuid4()), "dealer_org_id": org.org_id, "replace": True})
    finally:
        _clear()
    _as(_mk_user(db_session, "inventory_controller"))
    try:
        r = client.put(f"{URL}/{cid}/counts", json={"entries": [{"product_id": str(a.id), "qty": 1}]})
        assert r.status_code == 200 and r.json()["count"]["is_active"] is False
        assert r.json()["count"]["counted_lines"] == 1
        # Telefon ro'yxatida faqat faol sanov.
        active = client.get(URL, params={"active": True, "dealer_org_id": org.org_id, "limit": 500}).json()["items"]
        assert cid not in {c["id"] for c in active} and len(active) == 1
    finally:
        _clear()


# --- qayta skan: qo'shish, takror yuborish, bekor qilish, tarix ---------------------


def test_rescan_adds_from_two_workers_and_keeps_history(client: TestClient, db_session: Session, monkeypatch):
    """Ikki xodim bir qatorga qo'shsa — ikkalasi ham qo'shiladi (jami yuborilmaydi, qo'shimcha keladi)."""
    org = _org(db_session, wh="wh30")
    a = _product(db_session, "A")
    _patch_smartup(monkeypatch, {a.sku: 10})
    cid = _sheet(client, db_session, org, [a.sku])
    u1, u2 = _mk_user(db_session, "inventory_controller"), _mk_user(db_session, "inventory_controller")
    _as(u1)
    try:
        r = client.put(f"{URL}/{cid}/counts", json={"entries": [{"op_id": str(uuid.uuid4()), "mode": "set", "product_id": str(a.id), "qty": 4}]})
        line_id = r.json()["count"]["lines"][0]["id"]
        client.put(f"{URL}/{cid}/counts", json={"entries": [{"op_id": str(uuid.uuid4()), "mode": "add", "line_id": line_id, "product_id": str(a.id), "qty": 3}]})
    finally:
        _clear()
    _as(u2)
    try:
        # Oflayn telefon: nusxasida hali 4 edi, kech ulandi — baribir qo'shiladi.
        r = client.put(f"{URL}/{cid}/counts", json={"entries": [{"op_id": str(uuid.uuid4()), "mode": "add", "line_id": line_id, "product_id": str(a.id), "qty": 2, "counted_at": _at(30)}]})
        ln = r.json()["count"]["lines"][0]
        assert float(ln["qty"]) == 9
        assert ln["entries_count"] == 3 and ln["entries_brief"] == "4 + 3 + 2"
        hist = client.get(f"{URL}/{cid}/lines/{line_id}/entries").json()
        assert [h["kind"] for h in hist] == ["set", "add", "add"]
        assert all(h["user_name"] for h in hist)
    finally:
        _clear()


def test_same_op_sent_twice_is_applied_once_and_undo(client: TestClient, db_session: Session, monkeypatch):
    org = _org(db_session, wh="wh30")
    a = _product(db_session, "A")
    _patch_smartup(monkeypatch, {a.sku: 10})
    cid = _sheet(client, db_session, org, [a.sku])
    _as(_mk_user(db_session, "inventory_controller"))
    try:
        base = client.put(f"{URL}/{cid}/counts", json={"entries": [{"op_id": str(uuid.uuid4()), "product_id": str(a.id), "qty": 12}]})
        line_id = base.json()["count"]["lines"][0]["id"]
        add = {"op_id": str(uuid.uuid4()), "mode": "add", "line_id": line_id, "product_id": str(a.id), "qty": 5}
        first = client.put(f"{URL}/{cid}/counts", json={"entries": [add]})
        again = client.put(f"{URL}/{cid}/counts", json={"entries": [add]})  # javob yo'qolib qayta yuborildi
        assert again.json()["duplicate"] == 1
        assert float(again.json()["count"]["lines"][0]["qty"]) == 17
        assert float(first.json()["count"]["lines"][0]["qty"]) == 17
        undo = {"op_id": str(uuid.uuid4()), "mode": "undo", "undo_op_id": add["op_id"]}
        u = client.put(f"{URL}/{cid}/counts", json={"entries": [undo]})
        assert u.json()["undone"] == 1 and float(u.json()["count"]["lines"][0]["qty"]) == 12
        assert u.json()["count"]["lines"][0]["entries_brief"] is None
        # Bekor qilishni qayta yuborish zararsiz.
        u2 = client.put(f"{URL}/{cid}/counts", json={"entries": [{**undo, "op_id": str(uuid.uuid4())}]})
        assert u2.json()["undone"] == 0 and float(u2.json()["count"]["lines"][0]["qty"]) == 12
        # Qo'shish 0 yoki manfiy bo'lmaydi (kamaytirish — faqat tuzatish).
        bad = client.put(f"{URL}/{cid}/counts", json={"entries": [{"op_id": str(uuid.uuid4()), "mode": "add", "line_id": line_id, "qty": 0}]})
        assert bad.status_code == 400
    finally:
        _clear()


def test_web_correction_is_recorded_and_resets_brief(client: TestClient, db_session: Session, monkeypatch):
    org = _org(db_session, wh="wh30")
    a = _product(db_session, "A")
    _patch_smartup(monkeypatch, {a.sku: 10})
    cid = _sheet(client, db_session, org, [a.sku])
    _as(_mk_user(db_session, "inventory_controller"))
    try:
        r = client.put(f"{URL}/{cid}/counts", json={"entries": [{"op_id": str(uuid.uuid4()), "product_id": str(a.id), "qty": 4}]})
        line_id = r.json()["count"]["lines"][0]["id"]
        client.put(f"{URL}/{cid}/counts", json={"entries": [{"op_id": str(uuid.uuid4()), "mode": "add", "line_id": line_id, "qty": 3}]})
    finally:
        _clear()
    _as(_mk_user(db_session, "warehouse_admin"))
    try:
        p = client.patch(f"{URL}/{cid}/lines/{line_id}", json={"qty": 6})
        ln = p.json()["lines"][0]
        assert float(ln["qty"]) == 6 and ln["entries_count"] == 3 and ln["entries_brief"] is None
        kinds = [h["kind"] for h in client.get(f"{URL}/{cid}/lines/{line_id}/entries").json()]
        assert kinds.count("set") == 2 and kinds.count("add") == 1
    finally:
        _clear()
