"""Buyurtma manbasi guruhi: "shahar" va "region".

Bitta ta'rif ikki xil ishlatiladi:

* :func:`order_source_group` — Python obyekti bo'yicha (ro'yxat javoblarini to'ldirish);
* :func:`source_group_conditions` — SQL filtri (dashboard agregatlari).

Ikkisi noma'lum manbaga nisbatan **ataylab** farq qiladi. SQL varianti "shahar" ni
aniq ro'yxat (`smartup`, `orikzor`) bilan cheklaydi — statistika faqat ma'lum
manbalarni sanaydi. Python varianti esa "diller bo'lmasa — shahar" deydi, chunki u
UI tablarini to'ldiradi: har bir hujjat aynan bitta tabga tushmasa, ekranda umuman
ko'rinmay qolardi.
"""
from __future__ import annotations

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


def order_source_group(order: Optional[OrderModel]) -> str:
    """Buyurtma qaysi guruhga tegishli: `region` (diller) yoki `shahar` (qolgani).

    Buyurtmasiz hujjat ham `shahar` — dashboard bilan bir xil.
    """
    source = (getattr(order, "source", None) or "").strip().lower()
    return SOURCE_GROUP_REGION if source == REGION_SOURCE else SOURCE_GROUP_CITY


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
