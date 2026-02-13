from __future__ import annotations

import re
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

# Rack: S-{sector}-{level}-{row} e.g. S-15-01-02
# Floor: P-{sector}-{palletNo} e.g. P-AS-02
RACK_PATTERN = re.compile(r"^S-([^-]+)-(\d+)-(\d+)$", re.IGNORECASE)
FLOOR_PATTERN = re.compile(r"^P-([^-]+)-(\d+)$", re.IGNORECASE)


def parse_location_code(code: str) -> tuple[str | None, str | None, int | None, int | None, int | None]:
    """Parse code into (location_type, sector, level, row_no, pallet_no). Returns (None,...) if invalid."""
    code = (code or "").strip()
    m = RACK_PATTERN.match(code)
    if m:
        return ("RACK", m.group(1), int(m.group(2)), int(m.group(3)), None)
    m = FLOOR_PATTERN.match(code)
    if m:
        return ("FLOOR", m.group(1), None, None, int(m.group(2)))
    return (None, None, None, None, None)


def validate_location_code_format(code: str, location_type: str | None) -> None:
    """Raise ValueError if code does not match the expected format for location_type."""
    code = (code or "").strip()
    if location_type == "RACK":
        if not RACK_PATTERN.match(code):
            raise ValueError("RACK code must match S-{sector}-{level}-{row}, e.g. S-15-01-02")
    elif location_type == "FLOOR":
        if not FLOOR_PATTERN.match(code):
            raise ValueError("FLOOR code must match P-{sector}-{palletNo}, e.g. P-AS-02")
    # location_type None or other: no format enforced
    return None


def generate_location_code(
    location_type: str,
    sector: str,
    level_no: int | None = None,
    row_no: int | None = None,
    pallet_no: int | None = None,
) -> str:
    """Generate location code from structured fields. Raises ValueError if invalid."""
    sector = (sector or "").strip()
    if not sector:
        raise ValueError("sector is required")
    if location_type == "RACK":
        if level_no is None or row_no is None:
            raise ValueError("level_no and row_no are required for RACK")
        return f"S-{sector}-{level_no:02d}-{row_no:02d}"
    if location_type == "FLOOR":
        if pallet_no is None:
            raise ValueError("pallet_no is required for FLOOR")
        return f"P-{sector}-{pallet_no:02d}"
    raise ValueError("location_type must be RACK or FLOOR")


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    location_type: Mapped[str | None] = mapped_column(String(32), nullable=True)  # RACK | FLOOR
    sector: Mapped[str | None] = mapped_column(String(64), nullable=True)
    level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    row_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pallet_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    parent = relationship("Location", remote_side="Location.id", backref="children")

    __table_args__ = (
        Index("ix_locations_parent_id", "parent_id"),
        Index("ix_locations_type", "type"),
        Index("ix_locations_is_active", "is_active"),
        Index("ix_locations_sector", "sector"),
        Index("ix_locations_location_type", "location_type"),
    )
