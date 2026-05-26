from app.integrations.smartup.mapper import map_order_to_wms_order
from app.integrations.smartup.schemas import SmartupOrder


def test_map_order_does_not_use_warehouse_code_as_to_filial() -> None:
    order = SmartupOrder(
        external_id="mfm:1",
        deal_id="1",
        order_no="1",
        status="W",
        filial_id="001",
        from_warehouse_code="001",
        lines=[],
    )
    payload = map_order_to_wms_order(order)
    assert payload.to_filial_code is None
    assert payload.filial_id is None


def test_map_order_uses_org_filial_id() -> None:
    order = SmartupOrder(
        external_id="mfm:2",
        deal_id="2",
        order_no="2",
        status="C",
        filial_id="001",
        to_filial_code="3964966",
        lines=[],
    )
    payload = map_order_to_wms_order(order)
    assert payload.to_filial_code == "3964966"
    assert payload.filial_id == "3964966"
