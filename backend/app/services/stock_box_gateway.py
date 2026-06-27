"""Stock + quti mutatsiyalari uchun yagona darvoza.

Maqsad: terish va terishni qaytarish naqshini (stock movement jufti + yopiq
quti chelagi + invariant) bitta joyda jamlash. Bu yangi oqim qo'shilganda
sealed chelak total bilan moslshini kafolatlaydi (drift'ni oldini oladi).

Eslatma: bu darvoza faqat movement-juftini va qaytarishda quti tiklash +
invariant tekshiruvini boshqaradi. Terishdagi quti olish/ochish side-effectlari
(`apply_scan_pick_side_effects`, `apply_hybrid_pick_side_effects`) avvalgidek
alohida chaqiriladi — ular skan turiga bog'liq murakkab mantiq.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.stock import StockMovement as StockMovementModel
from app.services.box_location_service import (
    assert_box_invariant,
    restore_sealed_boxes_for_unpick,
)

_PICK_MOVEMENT_TYPES = ("pick", "unallocate")


def _add_movement_pair(
    db: Session,
    *,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
    qty_change: Decimal,
    document_id: UUID,
    created_by_user_id: UUID,
) -> None:
    for movement_type in _PICK_MOVEMENT_TYPES:
        db.add(
            StockMovementModel(
                product_id=product_id,
                lot_id=lot_id,
                location_id=location_id,
                qty_change=qty_change,
                movement_type=movement_type,
                source_document_type="document",
                source_document_id=document_id,
                created_by_user_id=created_by_user_id,
            )
        )


def record_pick(
    db: Session,
    *,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
    qty: Decimal,
    document_id: UUID,
    created_by_user_id: UUID,
) -> None:
    """Terish: fizik (pick) va rezerv (unallocate) ni `qty` ga kamaytiradi.

    Quti olish/ochish side-effecti chaqiruvchida alohida bajariladi. Invariant
    bu yerda majburlanmaydi: eski (drift qilingan) ma'lumotda terishni bloklab
    qo'ymaslik uchun — invariant faqat qaytarish/ko'chirishda tekshiriladi.
    """
    _add_movement_pair(
        db,
        product_id=product_id,
        lot_id=lot_id,
        location_id=location_id,
        qty_change=-Decimal(str(qty)),
        document_id=document_id,
        created_by_user_id=created_by_user_id,
    )


def record_pick_rollback(
    db: Session,
    *,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
    qty: Decimal,
    document_id: UUID,
    created_by_user_id: UUID,
) -> int:
    """Terishni qaytarish (unpick/skip/safe-cancel): fizik+rezerv tiklash,
    butun-quti pick'larini yopiq holatda qaytarish va invariantni tekshirish.

    Returns: tiklangan yopiq qutilar soni.
    """
    qty_dec = Decimal(str(qty))
    _add_movement_pair(
        db,
        product_id=product_id,
        lot_id=lot_id,
        location_id=location_id,
        qty_change=qty_dec,
        document_id=document_id,
        created_by_user_id=created_by_user_id,
    )
    db.flush()
    restored = restore_sealed_boxes_for_unpick(
        db,
        lot_id=lot_id,
        location_id=location_id,
        source_document_id=document_id,
        returned_qty=qty_dec,
    )
    assert_box_invariant(db, lot_id, location_id)
    return restored
