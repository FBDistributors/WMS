"""Hamma qatori VIP-muddat ma'lumot bo'lgan buyurtma yig'uvchida qotib qolmasligi:
picker complete -> send-to-controller -> controller complete oqimi ishlashi kerak."""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.document import Document, DocumentLine
from app.models.product import Product
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


def test_all_vip_info_order_flows_picker_to_controller(
    client: TestClient, db_session: Session
) -> None:
    picker = _mk_user(db_session, "picker")
    controller = _mk_user(db_session, "inventory_controller")

    product = Product(
        external_source="test",
        external_id=f"ext-{uuid.uuid4().hex[:8]}",
        name="VIP info product",
        sku=f"SKU-VIPINFO-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()

    doc = Document(
        doc_no=f"SO-{uuid.uuid4().hex[:8]}",
        doc_type="SO",
        status="in_progress",
        assigned_to_user_id=picker.id,
    )
    db_session.add(doc)
    db_session.flush()
    # Ikkala qator ham VIP-info: yig'ilmaydi, allokatsiya yo'q (lot/location None).
    for i in range(2):
        db_session.add(
            DocumentLine(
                document_id=doc.id,
                product_id=product.id,
                sku=product.sku,
                product_name=f"Line {i}",
                required_qty=6.0,
                picked_qty=0.0,
                is_vip_expiry_informational=True,
            )
        )
    db_session.commit()
    doc_id = doc.id

    app.dependency_overrides[get_current_user] = lambda: picker
    try:
        # 1) Yig'uvchi yakunlaydi — hech narsa terilmagan bo'lsa ham (hammasi VIP-info).
        complete = client.post(f"/api/v1/picking/documents/{doc_id}/complete")
        assert complete.status_code == 200, complete.text
        # 2) Controllerga yuborish ishlashi kerak (picked_any=false bo'lса ham).
        send = client.post(
            f"/api/v1/picking/documents/{doc_id}/send-to-controller",
            json={"controller_user_id": str(controller.id)},
        )
        assert send.status_code == 200, send.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    db_session.expire_all()
    doc_after_send = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc_after_send.status == "picked"
    assert doc_after_send.controlled_by_user_id == controller.id

    # 3) Controller yakunlaydi.
    app.dependency_overrides[get_current_user] = lambda: controller
    try:
        ctrl_complete = client.post(f"/api/v1/picking/documents/{doc_id}/complete")
        assert ctrl_complete.status_code == 200, ctrl_complete.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    db_session.expire_all()
    doc_final = db_session.query(Document).filter(Document.id == doc_id).one()
    assert doc_final.status == "completed"
