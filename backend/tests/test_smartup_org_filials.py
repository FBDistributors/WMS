from app.services.organization_labels import (
    resolve_org_display,
    resolve_org_filial_id_from_note,
)

SETTINGS_MAP = {
    "19191043": "Дилер Фергана (Тавакал) Проф",
    "12398877": "Дилер Бухара (Жамшид)",
    "18640963": "Дилер Жиззах (Мунаввар) Проф",
    "8109104": "Дилер Таш обл (Мейрлан) Проф",
    "3964966": "Дилер Ипподром (Иззат)",
}


def test_resolve_org_filial_id_from_note_uses_settings_id() -> None:
    assert (
        resolve_org_filial_id_from_note("Заказ Дилер Таш обл (Мейрлан)", SETTINGS_MAP)
        == "8109104"
    )


def test_resolve_org_filial_id_from_xayitlik_uses_settings_id() -> None:
    assert resolve_org_filial_id_from_note("XAYITLIK FARGONA TAVA", SETTINGS_MAP) == "19191043"


def test_resolve_org_display_by_settings_org_id() -> None:
    assert (
        resolve_org_display("12398877", SETTINGS_MAP, to_filial_code="12398877")
        == "Дилер Бухара (Жамшид)"
    )


def test_resolve_org_display_from_note_settings_name() -> None:
    assert (
        resolve_org_display(None, SETTINGS_MAP, movement_note="XAYITLIK JIZZAX MUNAV")
        == "Дилер Жиззах (Мунаввар) Проф"
    )
