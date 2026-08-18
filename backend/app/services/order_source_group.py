"""Buyurtma manbasi guruhi: "shahar" va "region".

Bitta ta'rif ikki xil ishlatiladi:

* :func:`order_source_group` — Python obyekti bo'yicha (ro'yxat javoblarini to'ldirish);
* :func:`source_group_conditions` — SQL filtri (dashboard agregatlari).

Ikkisi noma'lum manbaga nisbatan **ataylab** farq qiladi. SQL varianti "shahar" ni
aniq ro'yxat (`smartup`, `orikzor`) bilan cheklaydi — statistika faqat ma'lum
manbalarni sanaydi. Python varianti esa "diller bo'lmasa — shahar" deydi, chunki u
UI tablarini to'ldiradi: har bir hujjat aynan bitta tabga tushmasa, ekranda umuman
ko'rinmay qolardi.

**Tarif guruhi alohida** (:func:`payroll_source_group`): 2026-07-26 davridan boshlab
o'rikzor pul hisobida region tarifini oladi, lekin ish oqimida (navbat tablari,
badge) shahar bo'lib qolaveradi.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy import or_

from app.models.document import Document as DocumentModel
from app.models.order import Order as OrderModel

SOURCE_GROUP_CITY = "shahar"
SOURCE_GROUP_REGION = "region"

#: SQL agregatlarida "shahar" deb sanaladigan manbalar.
CITY_SOURCES = ("smartup", "orikzor")
#: Tashkiliy harakat (MFM) — "region".
REGION_SOURCE = "diller"

#: Shu sanadan boshlangan ish haqi davrlarida o'rikzor region tarifida.
#: Oldingi davrlar eskicha — to'langan oy qayta hisoblanmaydi (payroll_rates
#: dagi effective_from printsipi bilan bir xil).
ORIKZOR_REGION_RATE_FROM = date(2026, 7, 26)

#: Tarifda region hisoblanadigan manbalar (kesish sanasidan keyin).
#: orikzor_manual — qo'lda yuklangan o'rikzor harakati (kelajakdagi manba).
PAYROLL_REGION_SOURCES = ("diller", "orikzor", "orikzor_manual")


def order_source_group(order: Optional[OrderModel]) -> str:
    """Buyurtma qaysi guruhga tegishli: `region` (diller) yoki `shahar` (qolgani).

    Buyurtmasiz hujjat ham `shahar` — dashboard bilan bir xil.
    """
    source = (getattr(order, "source", None) or "").strip().lower()
    return SOURCE_GROUP_REGION if source == REGION_SOURCE else SOURCE_GROUP_CITY


def payroll_source_group(source: Optional[str], as_of: date) -> str:
    """Tarif (ball/pul) guruhi. Ish oqimi guruhidan farqi: o'rikzor region.

    `as_of` — ish haqi davri BOSHI (26-sana). Kesish sanasidan oldingi davrlar
    eskicha shahar bo'lib qoladi: o'sha davrlar allaqachon shahar tarifida
    to'langan yoki ko'rsatilgan.
    """
    s = (source or "").strip().lower()
    if s == REGION_SOURCE:
        return SOURCE_GROUP_REGION
    if s in PAYROLL_REGION_SOURCES and as_of >= ORIKZOR_REGION_RATE_FROM:
        return SOURCE_GROUP_REGION
    return SOURCE_GROUP_CITY


def payroll_source_group_conditions(source_group: Optional[str], ts_col) -> list:
    """`source_group_conditions` ning tarif varianti (admin reytinglari uchun).

    Shart har hujjatning O'Z vaqtiga (`ts_col` — ish bajarilgan payt) bog'lanadi:
    kesish sanasi ish haqi davri chegarasiga tekis tushgani uchun bu xodim
    ilovasidagi "davr boshi >= kesish" qoidasi bilan ekvivalent, va sanasiz yoki
    kesishni kesib o'tuvchi diapazonlarda ham to'g'ri ishlaydi.

    Shahar ta'rifi SQL variantidagidek aniq ro'yxat bilan: noma'lum manba
    reytingga kirmaydi (source_group_conditions bilan izchil).
    """
    from app.core.business_time import day_bounds_in_tz

    cutover_dt = day_bounds_in_tz(ORIKZOR_REGION_RATE_FROM)[0]
    orikzor_sources = tuple(s for s in PAYROLL_REGION_SOURCES if s != REGION_SOURCE)
    if source_group == SOURCE_GROUP_REGION:
        return [
            or_(
                OrderModel.source == REGION_SOURCE,
                (OrderModel.source.in_(orikzor_sources)) & (ts_col >= cutover_dt),
            )
        ]
    if source_group == SOURCE_GROUP_CITY:
        city_always = tuple(s for s in CITY_SOURCES if s not in orikzor_sources)
        return [
            or_(
                OrderModel.source.in_(city_always),
                (OrderModel.source.in_(orikzor_sources)) & (ts_col < cutover_dt),
                DocumentModel.order_id.is_(None),
            )
        ]
    return []


def source_group_conditions(source_group: Optional[str], *, partition: bool = False) -> list:
    """Buyurtma manbasi bo'yicha SQL filtri; None — hamma manba (orqaga moslik).

    `partition=False` (dashboard): "shahar" faqat ma'lum manbalar — noma'lum manba
    hech qaysi guruhga sanalmaydi.

    `partition=True` (ro'yxat/UI tablari): "shahar" = "diller emas", ya'ni ikki guruh
    barcha hujjatlarni qoldiqsiz bo'ladi va noma'lum manbali hujjat yo'qolib qolmaydi.
    """
    if source_group == SOURCE_GROUP_CITY:
        if partition:
            return [
                or_(
                    DocumentModel.order_id.is_(None),
                    OrderModel.source.is_(None),
                    OrderModel.source != REGION_SOURCE,
                )
            ]
        return [or_(OrderModel.source.in_(CITY_SOURCES), DocumentModel.order_id.is_(None))]
    if source_group == SOURCE_GROUP_REGION:
        return [OrderModel.source == REGION_SOURCE]
    return []
