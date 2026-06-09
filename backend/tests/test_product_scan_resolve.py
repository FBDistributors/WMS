"""product_boxes va product_scan_resolve testlari."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy.orm import Session

from app.models.product import Product as ProductModel
from app.models.product_box import ProductBox as ProductBoxModel
from app.services.product_scan_resolve import resolve_product_scan


@pytest.fixture()
def sample_product(db_session: Session) -> ProductModel:
    product = ProductModel(
        external_source="test",
        external_id=f"ext-{uuid.uuid4()}",
        name="Box Test Product",
        sku=f"SKU-BOX-{uuid.uuid4().hex[:8]}",
        barcode="11112222",
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()
    return product


def test_resolve_product_scan_box(db_session: Session, sample_product: ProductModel) -> None:
    box = ProductBoxModel(
        box_barcode="BOX999888",
        product_id=sample_product.id,
        units_per_box=12,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()

    resolved = resolve_product_scan(db_session, "BOX999888")
    assert resolved is not None
    assert resolved.scan_kind == "box"
    assert resolved.units_per_scan == 12
    assert resolved.product_id == sample_product.id


def test_resolve_product_scan_unit_barcode(db_session: Session, sample_product: ProductModel) -> None:
    resolved = resolve_product_scan(db_session, "11112222")
    assert resolved is not None
    assert resolved.scan_kind == "unit"
    assert resolved.units_per_scan == 1
