from app.integrations.smartup.importer import import_orders
from app.integrations.smartup.schemas import SmartupOrder
from app.models.order import Order


def _smartup_order(
    *,
    external_id: str,
    order_no: str,
    customer_name: str,
    qty: float,
    status: str = "B#W",
) -> SmartupOrder:
    return SmartupOrder(
        external_id=external_id,
        deal_id=external_id,
        order_no=order_no,
        status=status,
        customer_name=customer_name,
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


def test_completed_order_matching_reimport_is_skipped(db_session) -> None:
    first = _smartup_order(
        external_id="ext-completed-same",
        order_no="SO-1001",
        customer_name="Client A",
        qty=2,
    )
    created, updated, skipped, errors, skipped_by_reason = import_orders(db_session, [first])
    assert (created, updated, skipped, len(errors)) == (1, 0, 0, 0)

    order = db_session.query(Order).filter(Order.source_external_id == "ext-completed-same").one()
    order.wms_state.status = "completed"
    order.customer_name = "Frozen Client"
    db_session.commit()

    same_payload = _smartup_order(
        external_id="ext-completed-same",
        order_no="SO-1001",
        customer_name="Changed Client",
        qty=2,
    )
    created2, updated2, skipped2, errors2, skipped_by_reason2 = import_orders(db_session, [same_payload])

    assert (created2, updated2, skipped2, len(errors2)) == (0, 0, 1, 0)
    assert skipped_by_reason2["completed_match_skipped"] == 1

    db_session.refresh(order)
    assert order.wms_state.status == "completed"
    assert order.customer_name == "Frozen Client"
    assert len(order.lines) == 1
    assert order.lines[0].qty == 2


def test_completed_order_reimport_with_line_change_updates_record(db_session) -> None:
    first = _smartup_order(
        external_id="ext-completed-diff",
        order_no="SO-1002",
        customer_name="Client B",
        qty=2,
    )
    import_orders(db_session, [first])

    order = db_session.query(Order).filter(Order.source_external_id == "ext-completed-diff").one()
    order.wms_state.status = "completed"
    db_session.commit()

    changed_payload = _smartup_order(
        external_id="ext-completed-diff",
        order_no="SO-1002",
        customer_name="Client B Changed",
        qty=3,
    )
    created, updated, skipped, errors, skipped_by_reason = import_orders(db_session, [changed_payload])

    assert (created, updated, skipped, len(errors)) == (0, 1, 0, 0)
    assert skipped_by_reason["completed_match_skipped"] == 0

    db_session.refresh(order)
    assert order.wms_state.status == "completed"
    assert order.customer_name == "Client B Changed"
    assert len(order.lines) == 1
    assert order.lines[0].qty == 3


def test_imported_order_matching_reimport_still_updates(db_session) -> None:
    first = _smartup_order(
        external_id="ext-imported-same",
        order_no="SO-1003",
        customer_name="Client C",
        qty=1,
    )
    import_orders(db_session, [first])

    same_payload = _smartup_order(
        external_id="ext-imported-same",
        order_no="SO-1003",
        customer_name="Client C Updated",
        qty=1,
    )
    created, updated, skipped, errors, skipped_by_reason = import_orders(db_session, [same_payload])

    assert (created, updated, skipped, len(errors)) == (0, 1, 0, 0)
    assert skipped_by_reason["completed_match_skipped"] == 0

    order = db_session.query(Order).filter(Order.source_external_id == "ext-imported-same").one()
    assert order.wms_state.status == "imported"
    assert order.customer_name == "Client C Updated"
