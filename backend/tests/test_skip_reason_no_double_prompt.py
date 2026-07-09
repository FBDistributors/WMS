"""Skip qilingan qator "hal qilingan" deb sanaladi: controllerga yuborishda
qayta sabab so'ralmaydi. Bir marta berilgan sabab qolgan sababsiz qatorlarga
tarqaladi (qizil + sabab). Terilmagan qatorga ham skip qo'yish mumkin."""
from __future__ import annotations

import uuid

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


def _seed_doc_with_lines(db: Session, picker: User, n_lines: int) -> tuple[Document, list[DocumentLine]]:
    product = Product(
        external_source="test",
        external_id=f"ext-{uuid.uuid4().hex[:8]}",
        name="Prod",
        sku=f"SKU-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db.add(product)
    loc = Location(
        code=f"L-{uuid.uuid4().hex[:6]}",
        barcode_value=f"L-{uuid.uuid4().hex[:6]}",
        name="Bin",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    db.add(loc)
    db.flush()
    doc = Document(
        doc_no=f"SO-{uuid.uuid4().hex[:8]}",
        doc_type="SO",
        status="in_progress",
        assigned_to_user_id=picker.id,
    )
    db.add(doc)
    db.flush()
    lines: list[DocumentLine] = []
    for i in range(n_lines):
        lot = StockLot(product_id=product.id, batch=f"B{i}", expiry_date=None)
        db.add(lot)
        db.flush()
        db.add(
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=loc.id,
                qty_change=10,
                movement_type="receipt",
            )
        )
        # Terish uchun rezerv (allocate) — pick require_sufficient_reserved talab qiladi.
        db.add(
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=loc.id,
                qty_change=3,
                movement_type="allocate",
            )
        )
        ln = DocumentLine(
            document_id=doc.id,
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            sku=product.sku,
            product_name=f"Line {i}",
            location_code=loc.code,
            required_qty=3.0,
            picked_qty=0.0,
        )
        db.add(ln)
        lines.append(ln)
    db.commit()
    for ln in lines:
        db.refresh(ln)
    db.refresh(doc)
    return doc, lines


def test_skip_unpicked_line_then_complete_needs_no_second_reason(
    client: TestClient, db_session: Session
) -> None:
    picker = _mk_user(db_session, "picker")
    controller = _mk_user(db_session, "inventory_controller")
    doc, lines = _seed_doc_with_lines(db_session, picker, n_lines=2)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        # 1) Terilmagan qatorga sabab qo'yish (termasdan).
        skip = client.post(
            f"/api/v1/picking/lines/{lines[0].id}/skip",
            json={"reason": "damaged"},
        )
        assert skip.status_code == 200, skip.text
        # 2) Ikkinchi qatorni to'liq terish.
        pick = client.post(
            f"/api/v1/picking/lines/{lines[1].id}/pick",
            json={"delta": 3, "request_id": f"pk-{uuid.uuid4().hex}"},
        )
        assert pick.status_code == 200, pick.text
        # 3) Yakunlash — endi sababsiz qator yo'q, incomplete_reason talab qilinmaydi.
        complete = client.post(f"/api/v1/picking/documents/{doc.id}/complete")
        assert complete.status_code == 200, complete.text
        # 4) Controllerga yuborish — qayta sabab so'ralmaydi.
        send = client.post(
            f"/api/v1/picking/documents/{doc.id}/send-to-controller",
            json={"controller_user_id": str(controller.id)},
        )
        assert send.status_code == 200, send.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    db_session.expire_all()
    l0 = db_session.query(DocumentLine).filter(DocumentLine.id == lines[0].id).one()
    assert l0.skip_reason == "damaged"
    assert l0.picked_qty == 0


def test_complete_reason_propagates_to_unreasoned_lines(
    client: TestClient, db_session: Session
) -> None:
    """10 qatordan biri terilib, qolganlarга bitta umumiy sabab — har biriga tarqaladi."""
    picker = _mk_user(db_session, "picker")
    doc, lines = _seed_doc_with_lines(db_session, picker, n_lines=3)

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        pick = client.post(
            f"/api/v1/picking/lines/{lines[0].id}/pick",
            json={"delta": 3, "request_id": f"pk-{uuid.uuid4().hex}"},
        )
        assert pick.status_code == 200, pick.text
        # Sababsiz 2 qator bor -> sabab talab qilinadi.
        no_reason = client.post(f"/api/v1/picking/documents/{doc.id}/complete")
        assert no_reason.status_code == 409, no_reason.text
        # Bir marta sabab -> ikkala sababsiz qatorga tarqaladi.
        ok = client.post(
            f"/api/v1/picking/documents/{doc.id}/complete",
            json={"incomplete_reason": "out_of_stock"},
        )
        assert ok.status_code == 200, ok.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    db_session.expire_all()
    l1 = db_session.query(DocumentLine).filter(DocumentLine.id == lines[1].id).one()
    l2 = db_session.query(DocumentLine).filter(DocumentLine.id == lines[2].id).one()
    assert l1.skip_reason == "out_of_stock"
    assert l2.skip_reason == "out_of_stock"
