"""Butun sektorni ko'chirish rejasi: `P-H → P-K`, joy-joyga.

Reja qurish preview va haqiqiy ko'chirish uchun **bitta** manba bo'lishi shart:
ko'chirish "hammasi yoki hech narsa" tamoyilida ishlaydi, ya'ni foydalanuvchi
tugmani bosishdan oldin ko'rgan holat bajarilish paytidagi holat bilan mos
kelishi kerak.

Muddat to'qnashuvi `check_location_single_expiry` ning o'zi bilan tekshiriladi
(nusxa mantiq yozilmaydi) — aks holda preview "bo'ladi" deb ko'rsatib, bajarilish
400 bilan yiqilishi mumkin edi.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.endpoints.picker_inventory import _get_lot_level_balances
from app.core.stock_rules import check_location_single_expiry
from app.models.location_box_placement import (
    PLACEMENT_SEALED,
    LocationBoxPlacement as LocationBoxPlacementModel,
)
from app.models.stock import StockLot as StockLotModel
from app.services.location_sector import (
    SectorInfo,
    SectorLocation,
    load_sector,
    map_sector_positions,
)
from app.services.location_transfer_service import reserved_by_location

#: Bitta sektorda ruxsat etilgan joylar soni — tranzaksiya cheksiz o'smasin.
MAX_SECTOR_LOCATIONS = 500

STATUS_OK = "ok"
#: Manbada qoldiq yo'q — ko'chirishda o'tkazib yuboriladi.
STATUS_EMPTY = "empty"
#: Manzilda mos o'rin yo'q yoki nofaol.
STATUS_DEST_MISSING = "dest_missing"
#: Joyda terish uchun band zaxira bor.
STATUS_RESERVED = "reserved"
#: Manzilda shu mahsulotning boshqa muddati bor (yoki manbaning o'zi nomuvofiq).
STATUS_EXPIRY_CONFLICT = "expiry_conflict"
#: Manzil bo'sh emas — ogohlantirish, ko'chirishga to'sqinlik qilmaydi.
STATUS_DEST_NOT_EMPTY = "dest_not_empty"

#: Bu holatlar butun amalni bloklaydi.
BLOCKING_STATUSES = frozenset({STATUS_DEST_MISSING, STATUS_RESERVED, STATUS_EXPIRY_CONFLICT})
#: Bu holatlarda joy haqiqatan ko'chiriladi.
MOVABLE_STATUSES = frozenset({STATUS_OK, STATUS_DEST_NOT_EMPTY})


@dataclass
class SectorTransferRow:
    """Reja jadvalining bitta qatori: bitta manba joyi."""

    from_location_id: UUID
    from_code: str
    to_location_id: Optional[UUID]
    to_code: Optional[str]
    lines: int
    total_qty: Decimal
    boxes: int
    status: str

    @property
    def movable(self) -> bool:
        return self.status in MOVABLE_STATUSES

    @property
    def blocking(self) -> bool:
        return self.status in BLOCKING_STATUSES


@dataclass
class SectorTransferPlan:
    from_prefix: str
    to_prefix: str
    location_type: str
    rows: list[SectorTransferRow] = field(default_factory=list)

    @property
    def movable_rows(self) -> list[SectorTransferRow]:
        return [r for r in self.rows if r.movable]

    @property
    def blocking_rows(self) -> list[SectorTransferRow]:
        return [r for r in self.rows if r.blocking]

    @property
    def can_submit(self) -> bool:
        return not self.blocking_rows and bool(self.movable_rows)

    @property
    def locations_to_move(self) -> int:
        return len(self.movable_rows)

    @property
    def lines_to_move(self) -> int:
        return sum(r.lines for r in self.movable_rows)

    @property
    def boxes_to_move(self) -> int:
        return sum(r.boxes for r in self.movable_rows)

    @property
    def total_qty_to_move(self) -> Decimal:
        return sum((r.total_qty for r in self.movable_rows), Decimal("0"))


def _sealed_box_counts(db: Session, location_ids: list[UUID]) -> dict[UUID, int]:
    if not location_ids:
        return {}
    rows = (
        db.query(
            LocationBoxPlacementModel.location_id,
            func.count(LocationBoxPlacementModel.id).label("boxes"),
        )
        .filter(
            LocationBoxPlacementModel.location_id.in_(location_ids),
            LocationBoxPlacementModel.status == PLACEMENT_SEALED,
        )
        .group_by(LocationBoxPlacementModel.location_id)
        .all()
    )
    return {r.location_id: int(r.boxes) for r in rows}


def _stock_by_location(
    db: Session, location_ids: list[UUID]
) -> dict[UUID, list[dict]]:
    """Joy bo'yicha qoldiq qatorlari (faqat available > 0)."""
    if not location_ids:
        return {}
    rows = _get_lot_level_balances(db, product_ids=None, location_ids=location_ids)
    out: dict[UUID, list[dict]] = {}
    for r in rows:
        if Decimal(str(r["available"])) <= 0:
            continue
        out.setdefault(r["location_id"], []).append(r)
    return out


def _lot_expiries(db: Session, lot_ids: set[UUID]) -> dict[UUID, Optional[date]]:
    if not lot_ids:
        return {}
    rows = (
        db.query(StockLotModel.id, StockLotModel.expiry_date)
        .filter(StockLotModel.id.in_(list(lot_ids)))
        .all()
    )
    return {r.id: r.expiry_date for r in rows}


def _has_expiry_conflict(
    db: Session,
    *,
    source_rows: list[dict],
    dest: SectorLocation,
    expiry_by_lot: dict[UUID, Optional[date]],
    cache: dict[tuple[UUID, UUID, Optional[date]], bool],
) -> bool:
    """Manba tarkibi manzilga sig'adimi (bir joyda bir mahsulot — bitta muddat).

    Ikki holat tekshiriladi: (1) manbaning o'zida bir mahsulot ikki muddat bilan
    turgan bo'lsa — ko'chirilganda manzil nomuvofiq bo'ladi; (2) manzilda shu
    mahsulot boshqa muddat bilan mavjud bo'lsa.
    """
    expiries_by_product: dict[UUID, set[Optional[date]]] = {}
    for r in source_rows:
        expiries_by_product.setdefault(r["product_id"], set()).add(
            expiry_by_lot.get(r["lot_id"])
        )

    for product_id, expiries in expiries_by_product.items():
        if len(expiries) > 1:
            return True
        (expiry,) = tuple(expiries)
        key = (dest.id, product_id, expiry)
        if key not in cache:
            try:
                check_location_single_expiry(db, dest.id, product_id, expiry)
                cache[key] = False
            except HTTPException:
                cache[key] = True
        if cache[key]:
            return True
    return False


def build_sector_transfer_plan(
    db: Session, from_prefix: str, to_prefix: str
) -> SectorTransferPlan:
    """`P-H → P-K` rejasini quradi (hech narsa o'zgartirmaydi)."""
    source: SectorInfo = load_sector(db, from_prefix)
    destination: SectorInfo = load_sector(db, to_prefix)

    if source.prefix == destination.prefix:
        raise HTTPException(status_code=400, detail="Source and destination sectors must differ")
    if source.location_type != destination.location_type:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Sektor turlari mos emas: {source.prefix} — {source.location_type}, "
                f"{destination.prefix} — {destination.location_type}"
            ),
        )
    if len(source.locations) > MAX_SECTOR_LOCATIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Sektorda juda ko'p joy ({len(source.locations)}); "
                f"bir amalda {MAX_SECTOR_LOCATIONS} tagacha ko'chirish mumkin"
            ),
        )

    pairs = map_sector_positions(source, destination)
    source_ids = [src.id for src, _ in pairs]
    dest_ids = [dst.id for _, dst in pairs if dst is not None]

    stock = _stock_by_location(db, source_ids)
    boxes = _sealed_box_counts(db, source_ids)
    reserved = reserved_by_location(db, source_ids)
    dest_stock = _stock_by_location(db, dest_ids)
    dest_boxes = _sealed_box_counts(db, dest_ids)

    lot_ids = {r["lot_id"] for rows in stock.values() for r in rows}
    expiry_by_lot = _lot_expiries(db, lot_ids)
    expiry_cache: dict[tuple[UUID, UUID, Optional[date]], bool] = {}

    plan = SectorTransferPlan(
        from_prefix=source.prefix,
        to_prefix=destination.prefix,
        location_type=source.location_type,
    )

    for src, dst in pairs:
        rows = stock.get(src.id, [])
        box_count = boxes.get(src.id, 0)
        total_qty = sum(
            (Decimal(str(r["available"])) for r in rows), Decimal("0")
        )

        # Tartib muhim. Rezerv birinchi tekshiriladi: to'liq band joyda
        # available == 0 bo'ladi va qoldiq qatorlari umuman qaytmaydi, ya'ni joy
        # "bo'sh" ko'rinadi — aslida unda tovar bor va u fizik ko'chib ketardi.
        # Bo'sh joy esa manzil yo'qligidan ta'sirlanmaydi: ko'chadigan narsa yo'q.
        if reserved.get(src.id, Decimal("0")) > 0:
            status = STATUS_RESERVED
        elif not rows and box_count == 0:
            status = STATUS_EMPTY
        elif dst is None:
            status = STATUS_DEST_MISSING
        elif _has_expiry_conflict(
            db,
            source_rows=rows,
            dest=dst,
            expiry_by_lot=expiry_by_lot,
            cache=expiry_cache,
        ):
            status = STATUS_EXPIRY_CONFLICT
        elif dest_stock.get(dst.id) or dest_boxes.get(dst.id):
            status = STATUS_DEST_NOT_EMPTY
        else:
            status = STATUS_OK

        plan.rows.append(
            SectorTransferRow(
                from_location_id=src.id,
                from_code=src.code,
                to_location_id=dst.id if dst else None,
                to_code=dst.code if dst else None,
                lines=len(rows),
                total_qty=total_qty,
                boxes=box_count,
                status=status,
            )
        )

    return plan
