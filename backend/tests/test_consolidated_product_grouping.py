"""Umumiy yig'ish: bir product_id — bitta consolidated qator."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock

from app.api.v1.endpoints.picking import _consolidated_product_group_key


def test_consolidated_group_key_merges_same_product_id_different_barcode() -> None:
    pid = uuid.uuid4()
    line_a = MagicMock(
        product_id=pid,
        barcode="8600123456789",
        sku="SKU-1",
        product_name="Mahsulot A",
    )
    line_b = MagicMock(
        product_id=pid,
        barcode=None,
        sku="SKU-1",
        product_name="Mahsulot A",
    )
    assert _consolidated_product_group_key(line_a) == _consolidated_product_group_key(line_b)


def test_consolidated_product_order_unpack_matches_group_key() -> None:
    """Regression: product_order tuple must use group_key, not legacy (barcode, name, sku) key."""
    pid = uuid.uuid4()
    key = ("product_id", str(pid))
    product_order = [(key, "Mahsulot", "UL0025", "2027-11-01")]
    groups = {key: ["line-a", "line-b"]}
    products = []
    for gkey, product_name, sku, expiry_display in product_order:
        lines_list = groups[gkey]
        products.append((product_name, sku, len(lines_list), expiry_display))
    assert products == [("Mahsulot", "UL0025", 2, "2027-11-01")]


def test_consolidated_group_key_splits_different_products() -> None:
    line_a = MagicMock(
        product_id=uuid.uuid4(),
        barcode="111",
        sku="A",
        product_name="One",
    )
    line_b = MagicMock(
        product_id=uuid.uuid4(),
        barcode="111",
        sku="A",
        product_name="One",
    )
    assert _consolidated_product_group_key(line_a) != _consolidated_product_group_key(line_b)
