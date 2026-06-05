from app.integrations.smartup.importer import import_orders
from app.integrations.smartup.schemas import SmartupOrder
from app.models.order import Order


def _orikzor_order(*, external_id: str, order_no: str, qty: float = 2) -> SmartupOrder:
    return SmartupOrder(
        external_id=external_id,
        deal_id=external_id,
        order_no=order_no,
        status="S",
        customer_name="O'rikzor client",
        lines=[
            {
                "sku": "SKU-1",
                "barcode": "BAR-1",
                "name": "Product 1",
                "quantity": qty,
                "uom": "PCS",
                "price": "1000",
            }
        ],
    )


def test_orikzor_completed_matching_reimport_requeues_to_s(db_session) -> None:
    first = _orikzor_order(external_id="orikzor-ext-1", order_no="MV-1")
    created, updated, skipped, errors, skipped_by_reason = import_orders(
        db_session, [first], order_source="orikzor"
    )
    assert (created, updated, skipped, len(errors)) == (1, 0, 0, 0)

    order = db_session.query(Order).filter(Order.source_external_id == "orikzor-ext-1").one()
    order.wms_state.status = "completed"
    db_session.commit()

    same_payload = _orikzor_order(external_id="orikzor-ext-1", order_no="MV-1")
    created2, updated2, skipped2, errors2, skipped_by_reason2 = import_orders(
        db_session, [same_payload], order_source="orikzor"
    )

    assert (created2, updated2, skipped2, len(errors2)) == (0, 1, 0, 0)
    assert skipped_by_reason2.get("completed_match_skipped", 0) == 0

    db_session.refresh(order)
    assert order.wms_state.status == "S"
