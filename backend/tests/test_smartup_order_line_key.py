"""SmartUp import: order_products va order_actions bir xil SKU uchun alohida qator (uom = product_unit_id)."""
from app.integrations.smartup.importer import _payload_key
from app.integrations.smartup.mapper import OrderLinePayload


def test_payload_key_differs_when_uom_differs_same_sku_barcode_name() -> None:
    paid = OrderLinePayload(
        sku="UL0030",
        barcode="4605922006886",
        name='AXE "Dark Teptation"',
        qty=4.0,
        uom="1399336309",
        raw_json=None,
    )
    promo = OrderLinePayload(
        sku="UL0030",
        barcode="4605922006886",
        name='AXE "Dark Teptation"',
        qty=2.0,
        uom="1399336315",
        raw_json=None,
    )
    assert _payload_key(paid) != _payload_key(promo)


def test_payload_key_same_when_uom_matches() -> None:
    a = OrderLinePayload(sku="X", barcode="1", name="N", qty=1.0, uom="100", raw_json=None)
    b = OrderLinePayload(sku="X", barcode="1", name="N", qty=3.0, uom="100", raw_json=None)
    assert _payload_key(a) == _payload_key(b)
