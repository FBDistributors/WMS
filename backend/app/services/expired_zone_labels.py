from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.models.expired_zone_display_labels import EXPIRED_ZONE_LABELS_SINGLETON_ID, ExpiredZoneDisplayLabels
from app.models.location import Location as LocationModel


def get_labels_row(db: Session) -> ExpiredZoneDisplayLabels | None:
    return db.get(ExpiredZoneDisplayLabels, EXPIRED_ZONE_LABELS_SINGLETON_ID)


def resolve_expired_display_label(
    zone_type: str | None,
    expired_slot: str | None,
    row: ExpiredZoneDisplayLabels | None,
) -> int | None:
    if (zone_type or "") != "EXPIRED" or not expired_slot or expired_slot not in ("A", "B"):
        return None
    if row is None:
        return None
    if expired_slot == "A":
        return row.label_for_slot_a
    return row.label_for_slot_b


def assert_expired_slot_unique_for_warehouse(
    db: Session,
    *,
    location_id: UUID,
    warehouse_id: UUID | None,
    expired_slot: str | None,
    zone_type: str,
    is_active: bool,
) -> None:
    """At most one active EXPIRED location per warehouse may use slot A (and one for B)."""
    from fastapi import HTTPException, status

    if not is_active or (zone_type or "") != "EXPIRED" or not expired_slot:
        return
    q = (
        db.query(LocationModel.id)
        .filter(
            LocationModel.id != location_id,
            LocationModel.is_active.is_(True),
            LocationModel.zone_type == "EXPIRED",
            LocationModel.expired_slot == expired_slot,
        )
    )
    if warehouse_id is None:
        q = q.filter(LocationModel.warehouse_id.is_(None))
    else:
        q = q.filter(LocationModel.warehouse_id == warehouse_id)
    if q.first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"EXPIRED slot {expired_slot} allaqachon boshqa faol joyda band (shu ombor).",
        )
