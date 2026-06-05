from app.constants.order_wms_status import (
    smartup_movement_status_for_wms_storage,
    smartup_orikzor_status_for_wms_storage,
)


def test_smartup_movement_status_maps_w_and_c() -> None:
    assert smartup_movement_status_for_wms_storage("W") == "W"
    assert smartup_movement_status_for_wms_storage("B#W") == "W"
    assert smartup_movement_status_for_wms_storage("C") == "picking"
    assert smartup_movement_status_for_wms_storage("") == "W"
    assert smartup_movement_status_for_wms_storage("S") == "completed"


def test_smartup_orikzor_status_stores_literal_s() -> None:
    assert smartup_orikzor_status_for_wms_storage("S") == "S"
    assert smartup_orikzor_status_for_wms_storage("B#S") == "S"
    assert smartup_orikzor_status_for_wms_storage("") == "S"
    assert smartup_orikzor_status_for_wms_storage("A") == "cancelled"
