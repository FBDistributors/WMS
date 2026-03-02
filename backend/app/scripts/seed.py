from __future__ import annotations

import os

from app.auth.security import get_password_hash
from app.db import SessionLocal
from app.models.document import Document, DocumentLine
from app.models.product import Product, ProductBarcode
from app.models.user import User


def _ensure_document(
    doc_no: str,
    doc_type: str,
    status: str,
    lines: list[dict],
) -> Document:
    db = SessionLocal()
    try:
        existing = (
            db.query(Document)
            .filter(Document.doc_no == doc_no, Document.doc_type == doc_type)
            .one_or_none()
        )
        if existing:
            return existing

        document = Document(doc_no=doc_no, doc_type=doc_type, status=status)
        document.lines = [
            DocumentLine(
                sku=line.get("sku"),
                product_name=line["product_name"],
                barcode=line.get("barcode"),
                location_code=line.get("location_code", ""),
                required_qty=line["required_qty"],
                picked_qty=line.get("picked_qty", 0),
            )
            for line in lines
        ]
        db.add(document)
        db.commit()
        db.refresh(document)
        return document
    finally:
        db.close()


def _ensure_product(
    name: str,
    sku: str,
    barcodes: list[str] | None,
    is_active: bool,
) -> Product:
    db = SessionLocal()
    try:
        existing = db.query(Product).filter(Product.sku == sku).one_or_none()
        if existing:
            return existing

        product = Product(
            name=name,
            sku=sku,
            is_active=is_active,
        )
        product.barcodes = [ProductBarcode(barcode=value) for value in (barcodes or [])]
        db.add(product)
        db.commit()
        db.refresh(product)
        return product
    finally:
        db.close()


def _ensure_admin_user() -> User | None:
    username = os.getenv("ADMIN_USERNAME")
    password = os.getenv("ADMIN_PASSWORD")
    role = os.getenv("ADMIN_ROLE", "warehouse_admin")
    role = {
        "admin": "warehouse_admin",
        "manager": "supervisor",
    }.get(role, role)
    if not username or not password:
        return None

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == username).one_or_none()
        if existing:
            return existing

        user = User(
            username=username,
            password_hash=get_password_hash(password),
            role=role,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


def seed() -> None:
    _ensure_admin_user()
    _ensure_product(
        name="Shampun 250ml",
        sku="SKU-0001",
        barcodes=["8600000000011"],
        is_active=True,
    )
    _ensure_product(
        name="Krem 50ml",
        sku="SKU-0002",
        barcodes=["8600000000028"],
        is_active=True,
    )
    _ensure_product(
        name="Gel 200ml",
        sku="SKU-0003",
        barcodes=["8600000000035"],
        is_active=True,
    )

    _ensure_document(
        doc_no="SO-0001",
        doc_type="SO",
        status="confirmed",
        lines=[
            {
                "sku": "SKU-0001",
                "product_name": "Shampun 250ml",
                "barcode": "8600000000011",
                "location_code": "A-01-01",
                "required_qty": 5,
                "picked_qty": 0,
            },
            {
                "sku": "SKU-0002",
                "product_name": "Krem 50ml",
                "barcode": "8600000000028",
                "location_code": "A-01-02",
                "required_qty": 3,
                "picked_qty": 0,
            },
            {
                "sku": "SKU-0003",
                "product_name": "Gel 200ml",
                "barcode": "8600000000035",
                "location_code": "A-01-03",
                "required_qty": 2,
                "picked_qty": 0,
            },
        ],
    )
    _ensure_document(
        doc_no="SO-0002",
        doc_type="SO",
        status="in_progress",
        lines=[
            {
                "sku": "SKU-0004",
                "product_name": "Sabun 100g",
                "barcode": "8600000000042",
                "location_code": "B-02-01",
                "required_qty": 4,
                "picked_qty": 0,
            },
            {
                "sku": "SKU-0005",
                "product_name": "Loson 150ml",
                "barcode": "8600000000059",
                "location_code": "B-02-02",
                "required_qty": 6,
                "picked_qty": 0,
            },
            {
                "sku": "SKU-0006",
                "product_name": "Konditsioner 250ml",
                "barcode": "8600000000066",
                "location_code": "B-02-03",
                "required_qty": 1,
                "picked_qty": 0,
            },
        ],
    )


def main() -> None:
    seed()


if __name__ == "__main__":
    main()
