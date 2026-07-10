"""Controller tekshirishда qatorni sabab bilan belgilaydi: sababga qarab stock
joyiga qaytadi yoki brak/muddat zonasiga ko'chadi; buyurtma yakunlanadi."""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.document import Document, DocumentLine
from app.models.location import Location
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.services.stock_availability import compute_lot_location_balances


def _mk_user(db: Session, role: str) -> User:
    u = User(
        username=f"{role[:4]}-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role=role,
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _seed_picked_doc(db: Session, picker: User, controller: User):
    wh = Location(
        code=f"WH-{uuid.uuid4().hex[:6]}",
        barcode_value=f"WH-{uuid.uuid4().hex[:6]}",
        name="WH",
        type="warehouse",
        zone_type="NORMAL",
        is_active=True,
    )
    db.add(wh)
    db.flush()
    src = Location(
        code=f"S-{uuid.uuid4().hex[:6]}",
        barcode_value=f"S-{uuid.uuid4().hex[:6]}",
        name="Src",
        type="bin",
        zone_type="NORMAL",
        warehouse_id=wh.id,
        is_active=True,
    )
    damaged = Location(
        code=f"DMG-{uuid.uuid4().hex[:6]}",
        barcode_value=f"DMG-{uuid.uuid4().hex[:6]}",
        name="Damaged zone",
        type="bin",
        zone_type="DAMAGED",
        warehouse_id=wh.id,
        is_active=True,
    )
    db.add_all([src, damaged])
    product = Product(
        external_source="test",
        external_id=f"ext-{uuid.uuid4().hex[:8]}",
        name="Prod",
        sku=f"SKU-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db.add(product)
    db.flush()
    doc = Document(
        doc_no=f"SO-{uuid.uuid4().hex[:8]}",
        doc_type="SO",
        status="picked",
        assigned_to_user_id=picker.id,
        controlled_by_user_id=controller.id,
    )
    db.add(doc)
    db.flush()
    lines = []
    for _ in range(2):
        lot = StockLot(product_id=product.id, batch=f"B{uuid.uuid4().hex[:4]}", expiry_date=None)
        db.add(lot)
        db.flush()
        # receipt 5, allocate 3, keyin terilган holat: pick -3 + unallocate -3.
        db.add_all([
            StockMovement(product_id=product.id, lot_id=lot.id, location_id=src.id, qty_change=5, movement_type="receipt"),
            StockMovement(product_id=product.id, lot_id=lot.id, location_id=src.id, qty_change=3, movement_type="allocate"),
            StockMovement(product_id=product.id, lot_id=lot.id, location_id=src.id, qty_change=-3, movement_type="pick"),
            StockMovement(product_id=product.id, lot_id=lot.id, location_id=src.id, qty_change=-3, movement_type="unallocate"),
        ])
        ln = DocumentLine(
            document_id=doc.id,
            product_id=product.id,
            lot_id=lot.id,
            location_id=src.id,
            sku=product.sku,
            product_name="Line",
            location_code=src.code,
            required_qty=3.0,
            picked_qty=3.0,
        )
        db.add(ln)
        lines.append(ln)
    db.commit()
    for ln in lines:
        db.refresh(ln)
    db.refresh(doc)
    return doc, lines, src, damaged


def test_controller_flag_wrong_returns_to_source(client: TestClient, db_session: Session) -> None:
    picker = _mk_user(db_session, "picker")
    controller = _mk_user(db_session, "inventory_controller")
    doc, lines, src, _damaged = _seed_picked_doc(db_session, picker, controller)
    lot0 = lines[0].lot_id

    # Terilган holat: manba on_hand = 5-3 = 2.
    oh0, _r0, _a0 = compute_lot_location_balances(db_session, lot0, src.id)
    assert oh0 == Decimal("2")

    app.dependency_overrides[get_current_user] = lambda: controller
    try:
        resp = client.post(
            f"/api/v1/picking/lines/{lines[0].id}/controller-flag",
            json={"reason": "wrong_location"},
        )
        assert resp.status_code == 200, resp.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    db_session.expire_all()
    # Joyiga qaytdi: on_hand 2 -> 5.
    oh1, _r1, _a1 = compute_lot_location_balances(db_session, lot0, src.id)
    assert oh1 == Decimal("5")
    l0 = db_session.query(DocumentLine).filter(DocumentLine.id == lines[0].id).one()
    assert l0.skip_reason == "wrong_location"
    assert l0.picked_qty == 0


def test_controller_flag_damaged_moves_to_zone_and_completes(client: TestClient, db_session: Session) -> None:
    picker = _mk_user(db_session, "picker")
    controller = _mk_user(db_session, "inventory_controller")
    doc, lines, src, damaged = _seed_picked_doc(db_session, picker, controller)
    lot0 = lines[0].lot_id

    app.dependency_overrides[get_current_user] = lambda: controller
    try:
        # 1-qator nuqsonli -> DAMAGED zonaga.
        flag = client.post(
            f"/api/v1/picking/lines/{lines[0].id}/controller-flag",
            json={"reason": "damaged"},
        )
        assert flag.status_code == 200, flag.text
        # 2-qatorni tasdiqlab yakunlash (flagged qatorга verify shart emas).
        complete = client.post(f"/api/v1/picking/documents/{doc.id}/complete")
        assert complete.status_code == 200, complete.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    db_session.expire_all()
    # Manba on_hand o'zgarmaydi (terishда ketган): 2.
    oh_src, _r, _a = compute_lot_location_balances(db_session, lot0, src.id)
    assert oh_src == Decimal("2")
    # Brak zonaga +3 tushdi.
    oh_dmg, _r2, _a2 = compute_lot_location_balances(db_session, lot0, damaged.id)
    assert oh_dmg == Decimal("3")
    l0 = db_session.query(DocumentLine).filter(DocumentLine.id == lines[0].id).one()
    assert l0.skip_reason == "damaged"
    doc_after = db_session.query(Document).filter(Document.id == doc.id).one()
    assert doc_after.status == "completed"
