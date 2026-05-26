from app.constants.smartup_org_filials import resolve_org_filial_id_from_note
from app.services.organization_labels import resolve_org_display


def test_resolve_org_filial_id_from_note_tash_obl() -> None:
    assert (
        resolve_org_filial_id_from_note("Заказ Дилер Таш обл (Мейрлан)")
        == "8109104"
    )


def test_resolve_org_filial_id_from_note_ippodrom() -> None:
    assert resolve_org_filial_id_from_note("Заказ Дилер Ипподром") == "3964966"


def test_resolve_org_display_from_note_when_db_filial_empty() -> None:
    name = resolve_org_display(
        None,
        {},
        movement_note="Заказ Дилер Таш обл",
    )
    assert name == "Дилер Таш обл (Мейрлан) Проф"


def test_resolve_org_filial_id_from_xayitlik_fargona() -> None:
    assert resolve_org_filial_id_from_note("XAYITLIK FARGONA TAVA") == "8109101"


def test_resolve_org_filial_id_from_xayitlik_termiz() -> None:
    assert resolve_org_filial_id_from_note("XAYITLIK TERMIZ GAYRAT") == "8109111"


def test_resolve_org_filial_id_from_xayitlik_jizzax_munav() -> None:
    assert resolve_org_filial_id_from_note("XAYITLIK JIZZAX MUNAV") == "8109116"


def test_resolve_org_filial_id_from_xayitlik_qarshi() -> None:
    assert resolve_org_filial_id_from_note("XAYITLIK QARSHI ULUG") == "8109110"
