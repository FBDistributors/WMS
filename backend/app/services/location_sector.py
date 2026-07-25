"""Sektor (joy kodining `{tip}-{sektor}` prefiksi) bilan ishlash.

Sektor — `locations.sector` maydoni: `P-H-01`, `P-H-02` joylari `P-H` sektoriga
tegishli. Butun sektorni ko'chirishda joylar **o'rni bo'yicha** moslanadi
(`P-H-01 → P-K-01`), shuning uchun har bir joy tipiga xos "o'rin" kaliti kerak:

* FLOOR (`P-{sektor}-{palet}`) — palet raqami;
* RACK (`S-{sektor}-{qavat}-{qator}`) — (qavat, qator);
* SHOWROOM_RACK (`S-{sektor}-{qavat}`) — qavat.

O'rin kodning o'zidan olinadi (`parse_location_code`), tuzilmaviy ustunlardan
emas: kod noyob va har doim to'ldirilgan, `sector`/`level`/`pallet_no` esa eski
yozuvlarda bo'sh bo'lishi mumkin.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.location import Location as LocationModel, parse_location_code

#: `S-45` prefiksi ikki tipga mos kelishi mumkin — qaysi biri ekani bazadan aniqlanadi.
_PREFIX_TYPES: dict[str, tuple[str, ...]] = {
    "P": ("FLOOR",),
    "S": ("RACK", "SHOWROOM_RACK"),
}


@dataclass(frozen=True)
class SectorLocation:
    """Sektor ichidagi bitta joy."""

    id: UUID
    code: str
    location_type: str
    #: Sektor ichidagi o'rin — mos qo'yish kaliti.
    position: tuple[int, ...]
    zone_type: str


@dataclass(frozen=True)
class SectorInfo:
    """Sektor va uning joylari (o'rin bo'yicha tartiblangan)."""

    prefix: str
    location_type: str
    sector: str
    locations: tuple[SectorLocation, ...]

    def by_position(self) -> dict[tuple[int, ...], SectorLocation]:
        return {loc.position: loc for loc in self.locations}


def normalize_sector_input(text: str) -> str:
    """Kiritilgan matndan sektor prefiksini ajratadi.

    To'liq joy kodi ham qabul qilinadi: ombor xodimi sektorning o'zini skanerlay
    olmaydi, palet yorlig'ini (`P-H-03`) skanerlaydi — undan `P-H` chiqariladi.
    """
    parts = [p for p in (text or "").strip().upper().split("-") if p]
    if len(parts) < 2:
        raise ValueError("Sektor prefiksi {tip}-{sektor} ko'rinishida bo'lishi kerak, masalan P-H")
    return f"{parts[0]}-{parts[1]}"


def parse_sector_prefix(prefix: str) -> tuple[tuple[str, ...], str]:
    """`P-H` → (("FLOOR",), "H"). Nomalum tip bo'lsa ValueError."""
    normalized = normalize_sector_input(prefix)
    kind, sector = normalized.split("-", 1)
    types = _PREFIX_TYPES.get(kind)
    if not types:
        raise ValueError(f"Nomalum joy turi: {kind}- (kutilgan: P- yoki S-)")
    return types, sector


def _position_of(location_type: str, level: Optional[int], row_no: Optional[int], pallet_no: Optional[int]) -> Optional[tuple[int, ...]]:
    if location_type == "FLOOR":
        return (pallet_no,) if pallet_no is not None else None
    if location_type == "RACK":
        return (level, row_no) if level is not None and row_no is not None else None
    if location_type == "SHOWROOM_RACK":
        return (level,) if level is not None else None
    return None


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def load_sector(db: Session, prefix: str) -> SectorInfo:
    """Sektor joylarini yuklaydi. Topilmasa yoki noaniq bo'lsa HTTPException."""
    try:
        allowed_types, sector = parse_sector_prefix(prefix)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    normalized = normalize_sector_input(prefix)
    pattern = f"{_escape_like(normalized)}-%"
    rows = (
        db.query(LocationModel)
        .filter(
            LocationModel.is_active.is_(True),
            LocationModel.type != "warehouse",
            LocationModel.code.ilike(pattern, escape="\\"),
        )
        .all()
    )

    found: dict[str, list[SectorLocation]] = {}
    for row in rows:
        loc_type, parsed_sector, level, row_no, pallet_no = parse_location_code(row.code)
        if loc_type is None or loc_type not in allowed_types:
            continue
        if (parsed_sector or "").upper() != sector.upper():
            continue
        position = _position_of(loc_type, level, row_no, pallet_no)
        if position is None:
            continue
        found.setdefault(loc_type, []).append(
            SectorLocation(
                id=row.id,
                code=row.code,
                location_type=loc_type,
                position=position,
                zone_type=row.zone_type or "NORMAL",
            )
        )

    if not found:
        raise HTTPException(status_code=404, detail=f"Sektor topilmadi: {normalized}")
    if len(found) > 1:
        kinds = ", ".join(sorted(found))
        raise HTTPException(
            status_code=400,
            detail=f"Sektor {normalized} bir nechta joy turiga mos keladi ({kinds})",
        )

    location_type, locations = next(iter(found.items()))
    locations.sort(key=lambda loc: loc.position)
    return SectorInfo(
        prefix=normalized,
        location_type=location_type,
        sector=sector,
        locations=tuple(locations),
    )


def map_sector_positions(
    source: SectorInfo, destination: SectorInfo
) -> list[tuple[SectorLocation, Optional[SectorLocation]]]:
    """Manba joylarini manzil joylariga o'rni bo'yicha moslaydi.

    Manzilda mos o'rin bo'lmasa — `None` (chaqiruvchi buni bloklovchi holat
    sifatida ko'rsatadi).
    """
    dest_by_position = destination.by_position()
    return [(loc, dest_by_position.get(loc.position)) for loc in source.locations]
