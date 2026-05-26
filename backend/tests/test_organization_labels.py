"""Organization display name resolution."""

from app.services.organization_labels import resolve_org_display


def test_resolve_org_display_by_filial_id() -> None:
    name_map = {"3964966": "Дилер Ипподром (Иззат)"}
    assert (
        resolve_org_display("3964966", name_map, to_filial_code="3964966")
        == "Дилер Ипподром (Иззат)"
    )
    assert resolve_org_display("9999999", name_map) is None
    assert resolve_org_display("001", name_map, to_filial_code=None) is None


def test_resolve_org_display_fallback_without_settings() -> None:
    assert resolve_org_display("3964966", {}, to_filial_code="3964966") == "Дилер Ипподром (Иззат)"
