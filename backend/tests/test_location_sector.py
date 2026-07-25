"""Sektor prefiksi va joylarni o'rni bo'yicha moslash.

Sektor ko'chirish `P-H-01 → P-K-01` tamoyiliga quriladi, shuning uchun o'rin
kaliti va prefiks tahlili aniq bo'lishi shart.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.location import Location
from app.services.location_sector import (
    load_sector,
    map_sector_positions,
    normalize_sector_input,
    parse_sector_prefix,
)


def _mk_location(db: Session, code: str, *, is_active: bool = True) -> Location:
    loc = Location(
        code=code,
        barcode_value=f"{code}-{uuid.uuid4().hex[:6]}",
        name=code,
        type="bin",
        is_active=is_active,
    )
    db.add(loc)
    db.flush()
    return loc


class TestNormalizeSectorInput:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("P-H", "P-H"),
            # Ombor xodimi sektorni emas, palet yorlig'ini skanerlaydi.
            ("P-H-03", "P-H"),
            ("p-h-03", "P-H"),
            ("  P-AU-01  ", "P-AU"),
            ("S-45-01-02", "S-45"),
        ],
    )
    def test_prefix_is_extracted(self, raw: str, expected: str) -> None:
        assert normalize_sector_input(raw) == expected

    @pytest.mark.parametrize("raw", ["", "P", "   ", "-"])
    def test_incomplete_input_rejected(self, raw: str) -> None:
        with pytest.raises(ValueError):
            normalize_sector_input(raw)


class TestParseSectorPrefix:
    def test_floor_prefix(self) -> None:
        assert parse_sector_prefix("P-H") == (("FLOOR",), "H")

    def test_rack_prefix_is_ambiguous_by_code_alone(self) -> None:
        types, sector = parse_sector_prefix("S-45")
        assert sector == "45"
        assert set(types) == {"RACK", "SHOWROOM_RACK"}

    def test_unknown_kind_rejected(self) -> None:
        with pytest.raises(ValueError, match="Nomalum joy turi"):
            parse_sector_prefix("X-1")


class TestLoadSector:
    def test_floor_sector_sorted_by_pallet_no(self, db_session: Session) -> None:
        for code in ("P-H-03", "P-H-01", "P-H-02"):
            _mk_location(db_session, code)
        db_session.commit()

        info = load_sector(db_session, "P-H")

        assert info.prefix == "P-H"
        assert info.location_type == "FLOOR"
        assert [loc.code for loc in info.locations] == ["P-H-01", "P-H-02", "P-H-03"]
        assert [loc.position for loc in info.locations] == [(1,), (2,), (3,)]

    def test_scanned_full_code_resolves_to_its_sector(self, db_session: Session) -> None:
        _mk_location(db_session, "P-SC-01")
        _mk_location(db_session, "P-SC-02")
        db_session.commit()

        assert load_sector(db_session, "P-SC-02").prefix == "P-SC"

    def test_rack_sector_uses_level_and_row(self, db_session: Session) -> None:
        for code in ("S-77-02-01", "S-77-01-02", "S-77-01-01"):
            _mk_location(db_session, code)
        db_session.commit()

        info = load_sector(db_session, "S-77")

        assert info.location_type == "RACK"
        assert [loc.position for loc in info.locations] == [(1, 1), (1, 2), (2, 1)]

    def test_other_sectors_are_not_included(self, db_session: Session) -> None:
        _mk_location(db_session, "P-K-01")
        _mk_location(db_session, "P-KK-01")
        db_session.commit()

        assert [loc.code for loc in load_sector(db_session, "P-K").locations] == ["P-K-01"]

    def test_inactive_locations_are_skipped(self, db_session: Session) -> None:
        _mk_location(db_session, "P-IN-01")
        _mk_location(db_session, "P-IN-02", is_active=False)
        db_session.commit()

        assert [loc.code for loc in load_sector(db_session, "P-IN").locations] == ["P-IN-01"]

    def test_missing_sector_raises_404(self, db_session: Session) -> None:
        with pytest.raises(HTTPException) as err:
            load_sector(db_session, "P-ZZZ")
        assert err.value.status_code == 404

    def test_mixed_location_types_rejected(self, db_session: Session) -> None:
        # S-88-01 SHOWROOM_RACK, S-88-01-01 esa RACK — prefiks noaniq.
        _mk_location(db_session, "S-88-01")
        _mk_location(db_session, "S-88-01-01")
        db_session.commit()

        with pytest.raises(HTTPException) as err:
            load_sector(db_session, "S-88")
        assert err.value.status_code == 400
        assert "bir nechta joy turiga" in str(err.value.detail)

    def test_bad_prefix_raises_400(self, db_session: Session) -> None:
        with pytest.raises(HTTPException) as err:
            load_sector(db_session, "P")
        assert err.value.status_code == 400


class TestMapSectorPositions:
    def test_positions_are_matched_one_to_one(self, db_session: Session) -> None:
        for code in ("P-MA-01", "P-MA-02"):
            _mk_location(db_session, code)
        for code in ("P-MB-01", "P-MB-02"):
            _mk_location(db_session, code)
        db_session.commit()

        pairs = map_sector_positions(
            load_sector(db_session, "P-MA"), load_sector(db_session, "P-MB")
        )

        assert [(src.code, dst.code if dst else None) for src, dst in pairs] == [
            ("P-MA-01", "P-MB-01"),
            ("P-MA-02", "P-MB-02"),
        ]

    def test_missing_destination_position_is_reported_as_none(self, db_session: Session) -> None:
        for code in ("P-MC-01", "P-MC-02"):
            _mk_location(db_session, code)
        _mk_location(db_session, "P-MD-01")
        db_session.commit()

        pairs = map_sector_positions(
            load_sector(db_session, "P-MC"), load_sector(db_session, "P-MD")
        )

        assert pairs[0][1] is not None and pairs[0][1].code == "P-MD-01"
        assert pairs[1][1] is None

    def test_extra_destination_positions_are_ignored(self, db_session: Session) -> None:
        _mk_location(db_session, "P-ME-01")
        for code in ("P-MF-01", "P-MF-02", "P-MF-03"):
            _mk_location(db_session, code)
        db_session.commit()

        pairs = map_sector_positions(
            load_sector(db_session, "P-ME"), load_sector(db_session, "P-MF")
        )

        assert len(pairs) == 1
        assert pairs[0][1].code == "P-MF-01"
