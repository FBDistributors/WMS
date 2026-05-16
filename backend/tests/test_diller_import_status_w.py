"""Tashkiliy harakat (diller): SmartUp status bo'sh bo'lsa WMS da W saqlanishi."""

from app.integrations.smartup.importer import import_orders, reconcile_diller_imported_status_to_w
from app.integrations.smartup.schemas import SmartupOrder
from app.models.order import Order


def test_diller_import_without_smartup_status_stores_w(db_session) -> None:
    order = SmartupOrder(
        external_id="mfm:empty-status-1",
        deal_id="MV-1",
        order_no="MV-1",
        status=None,
        lines=[{"sku": "SKU-A", "name": "Item", "quantity": 1}],
    )
    created, updated, skipped, errors, _ = import_orders(
        db_session, [order], order_source="diller"
    )
    assert (created, updated, skipped, len(errors)) == (1, 0, 0, 0)
    row = db_session.query(Order).filter(Order.source_external_id == "mfm:empty-status-1").one()
    assert row.source == "diller"
    assert row.wms_state.status == "W"


def test_diller_import_smartup_c_stores_picking(db_session) -> None:
    """SmartUp C (yig'ish) DB da picking — Yangi tabda ko'rinmaydi."""
    order = SmartupOrder(
        external_id="mfm:status-c-1",
        deal_id="MV-9",
        order_no="MV-9",
        status="C",
        lines=[{"sku": "SKU-E", "name": "Item", "quantity": 1}],
    )
    import_orders(db_session, [order], order_source="diller")
    row = db_session.query(Order).filter(Order.source_external_id == "mfm:status-c-1").one()
    assert row.wms_state.status == "picking"


def test_diller_import_legacy_imported_token_stays_imported(db_session) -> None:
    order = SmartupOrder(
        external_id="mfm:parser-imported-1",
        deal_id="MV-10",
        order_no="MV-10",
        status="imported",
        lines=[{"sku": "SKU-E", "name": "Item", "quantity": 1}],
    )
    import_orders(db_session, [order], order_source="diller")
    row = db_session.query(Order).filter(Order.source_external_id == "mfm:parser-imported-1").one()
    assert row.wms_state.status == "imported"


def test_diller_import_b_hash_w_maps_to_w(db_session) -> None:
    order = SmartupOrder(
        external_id="mfm:bw-1",
        deal_id="MV-3",
        order_no="MV-3",
        status="B#W",
        lines=[{"sku": "SKU-D", "name": "Item", "quantity": 1}],
    )
    import_orders(db_session, [order], order_source="diller")
    row = db_session.query(Order).filter(Order.source_external_id == "mfm:bw-1").one()
    assert row.wms_state.status == "W"


def test_diller_reimport_empty_status_stays_w(db_session) -> None:
    order_b = SmartupOrder(
        external_id="mfm:fix-w-1",
        deal_id="MV-2",
        order_no="MV-2",
        status="B#W",
        lines=[{"sku": "SKU-B", "name": "Item", "quantity": 1}],
    )
    import_orders(db_session, [order_b], order_source="diller")
    row = db_session.query(Order).filter(Order.source_external_id == "mfm:fix-w-1").one()
    assert row.wms_state.status == "W"

    order_empty = SmartupOrder(
        external_id="mfm:fix-w-1",
        deal_id="MV-2",
        order_no="MV-2",
        status=None,
        lines=[{"sku": "SKU-B", "name": "Item", "quantity": 1}],
    )
    created, updated, skipped, errors, _ = import_orders(
        db_session, [order_empty], order_source="diller"
    )
    assert (created, updated, skipped, len(errors)) == (0, 1, 0, 0)
    db_session.refresh(row)
    assert row.wms_state.status == "W"


def test_reconcile_diller_imported_to_w(db_session) -> None:
    order = SmartupOrder(
        external_id="mfm:legacy-imported",
        deal_id="MV-L",
        order_no="MV-L",
        status=None,
        lines=[{"sku": "SKU-L", "name": "Item", "quantity": 1}],
    )
    import_orders(db_session, [order], order_source="smartup")
    row = db_session.query(Order).filter(Order.source_external_id == "mfm:legacy-imported").one()
    row.source = "diller"
    db_session.commit()

    n = reconcile_diller_imported_status_to_w(db_session)
    assert n == 1
    db_session.refresh(row)
    assert row.wms_state.status == "W"


def test_main_smartup_empty_status_stays_imported(db_session) -> None:
    order = SmartupOrder(
        external_id="ext-main-empty",
        deal_id="D1",
        order_no="SO-9",
        status=None,
        customer_name="C",
        lines=[{"sku": "SKU-C", "name": "Item", "quantity": 1}],
    )
    created, _, _, errors, _ = import_orders(db_session, [order])
    assert created == 1 and len(errors) == 0
    row = db_session.query(Order).filter(Order.source_external_id == "ext-main-empty").one()
    assert row.source == "smartup"
    assert row.wms_state.status == "imported"
