"""_customer_name fallback: tashkiliy harakat (diller) uchun filial nomi / izoh."""
from types import SimpleNamespace

from app.api.v1.endpoints.picking import _customer_name


def _doc(**order_fields):
    return SimpleNamespace(order=SimpleNamespace(**order_fields))


def test_customer_name_prefers_real_customer_name():
    doc = _doc(customer_name="ABDULLAYEV ABDULLA", to_filial_code="18877428", movement_note="x")
    assert _customer_name(doc, {"18877428": "Дилер Нукус"}) == "ABDULLAYEV ABDULLA"


def test_customer_name_falls_back_to_org_name_for_transfer():
    doc = _doc(customer_name=None, to_filial_code="18877428", movement_note="Заказ Нукус")
    assert _customer_name(doc, {"18877428": "Дилер Нукус (Андрей) Проф"}) == "Дилер Нукус (Андрей) Проф"


def test_customer_name_none_when_org_id_not_found():
    # ID-only: org_id settings'da topilmasa bo'sh (izohdan fuzzy-taxmin yo'q).
    doc = _doc(customer_name="", to_filial_code="99999", movement_note="Заказ Дилер Нукус")
    assert _customer_name(doc, {"18877428": "Дилер Нукус"}) is None


def test_customer_name_none_when_no_filial():
    # ID yo'q — izoh bor bo'lsa ham bo'sh (fuzzy-taxmin ishlatilmaydi).
    doc = _doc(customer_name=None, to_filial_code=None, movement_note="PROMO TERMIZ")
    assert _customer_name(doc, {}) is None


def test_customer_name_none_when_nothing_available():
    doc = _doc(customer_name=None, to_filial_code=None, movement_note=None)
    assert _customer_name(doc, {}) is None


def test_customer_name_no_order():
    assert _customer_name(SimpleNamespace(order=None), {}) is None
