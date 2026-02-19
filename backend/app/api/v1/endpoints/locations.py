from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.services.audit_service import (
    ACTION_CREATE,
    ACTION_DELETE,
    ACTION_UPDATE,
    get_client_ip,
    log_action,
)
from app.models.location import (
    Location as LocationModel,
    generate_location_code,
)

router = APIRouter()

LOCATION_TYPE_ENUM = {"RACK", "FLOOR"}


class LocationOut(BaseModel):
    id: UUID
    code: str
    barcode_value: str
    name: str
    type: str
    location_type: Optional[str] = None
    sector: Optional[str] = None
    level_no: Optional[int] = None
    row_no: Optional[int] = None
    pallet_no: Optional[int] = None
    parent_id: Optional[UUID] = None
    is_active: bool
    pick_sequence: Optional[int] = None
    created_at: Optional[str] = None


class LocationCreate(BaseModel):
    """Create location by type. Code is generated server-side."""

    location_type: str = Field(..., description="RACK or FLOOR")
    sector: str = Field(..., min_length=1, max_length=64)
    level_no: Optional[int] = Field(default=None, ge=0, le=99)
    row_no: Optional[int] = Field(default=None, ge=0, le=99)
    pallet_no: Optional[int] = Field(default=None, ge=0, le=99)
    is_active: bool = True


class LocationUpdate(BaseModel):
    """Update location. For RACK/FLOOR, pass sector/level_no/row_no or pallet_no to regenerate code."""

    sector: Optional[str] = Field(default=None, min_length=1, max_length=64)
    level_no: Optional[int] = Field(default=None, ge=0, le=99)
    row_no: Optional[int] = Field(default=None, ge=0, le=99)
    pallet_no: Optional[int] = Field(default=None, ge=0, le=99)
    is_active: Optional[bool] = None
    pick_sequence: Optional[int] = Field(default=None, ge=0, description="Terish ketma-ketligi (yo'nalish)")


def _to_location(location: LocationModel) -> LocationOut:
    return LocationOut(
        id=location.id,
        code=location.code,
        barcode_value=location.barcode_value or location.code,
        name=location.name,
        type=location.type,
        location_type=location.location_type,
        sector=location.sector,
        level_no=location.level,
        row_no=location.row_no,
        pallet_no=location.pallet_no,
        parent_id=location.parent_id,
        is_active=location.is_active,
        pick_sequence=location.pick_sequence,
        created_at=location.created_at.isoformat() if location.created_at else None,
    )


@router.get("", response_model=List[LocationOut], summary="List locations")
@router.get("/", response_model=List[LocationOut], summary="List locations")
async def list_locations(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("locations:manage")),
):
    query = db.query(LocationModel)
    if not include_inactive:
        query = query.filter(LocationModel.is_active.is_(True))
    locations = (
        query.order_by(
            LocationModel.pick_sequence.asc().nulls_last(),
            LocationModel.code.asc(),
        )
        .all()
    )
    return [_to_location(location) for location in locations]


@router.get("/{location_id}", response_model=LocationOut, summary="Get location by id")
async def get_location(
    location_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("locations:manage")),
):
    location = db.query(LocationModel).filter(LocationModel.id == location_id).one_or_none()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    return _to_location(location)


@router.post("", response_model=LocationOut, status_code=status.HTTP_201_CREATED, summary="Create location")
@router.post("/", response_model=LocationOut, status_code=status.HTTP_201_CREATED, summary="Create location")
async def create_location(
    request: Request,
    payload: LocationCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("locations:manage")),
):
    if payload.location_type not in LOCATION_TYPE_ENUM:
        raise HTTPException(status_code=400, detail="location_type must be RACK or FLOOR")
    try:
        code = generate_location_code(
            location_type=payload.location_type,
            sector=payload.sector,
            level_no=payload.level_no,
            row_no=payload.row_no,
            pallet_no=payload.pallet_no,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    existing = db.query(LocationModel).filter(LocationModel.code == code).one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Location code already exists")
    type_normalized = "rack" if payload.location_type == "RACK" else "floor"
    location = LocationModel(
        code=code,
        barcode_value=code,
        name=code,
        type=type_normalized,
        location_type=payload.location_type,
        sector=payload.sector,
        level=payload.level_no,
        row_no=payload.row_no,
        pallet_no=payload.pallet_no,
        parent_id=None,
        is_active=payload.is_active,
    )
    db.add(location)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_CREATE,
        entity_type="location",
        entity_id=str(location.id),
        new_data={"code": location.code, "type": location.type, "sector": location.sector},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(location)
    return _to_location(location)


@router.put("/{location_id}", response_model=LocationOut, summary="Update location")
@router.patch("/{location_id}", response_model=LocationOut, summary="Update location (PATCH)")
async def update_location(
    request: Request,
    location_id: UUID,
    payload: LocationUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("locations:manage")),
):
    location = db.query(LocationModel).filter(LocationModel.id == location_id).one_or_none()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    old_data = {"code": location.code, "is_active": location.is_active}
    if payload.is_active is not None:
        location.is_active = payload.is_active
    if "pick_sequence" in payload.model_dump(exclude_unset=True):
        location.pick_sequence = payload.pick_sequence
    if location.location_type in LOCATION_TYPE_ENUM and (
        payload.sector is not None or payload.level_no is not None or payload.row_no is not None or payload.pallet_no is not None
    ):
        sector = payload.sector if payload.sector is not None else (location.sector or "")
        level_no = payload.level_no if payload.level_no is not None else location.level
        row_no = payload.row_no if payload.row_no is not None else location.row_no
        pallet_no = payload.pallet_no if payload.pallet_no is not None else location.pallet_no
        try:
            new_code = generate_location_code(
                location_type=location.location_type,
                sector=sector,
                level_no=level_no,
                row_no=row_no,
                pallet_no=pallet_no,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if new_code != location.code:
            existing = db.query(LocationModel).filter(LocationModel.code == new_code).one_or_none()
            if existing:
                raise HTTPException(status_code=400, detail="Location code already exists")
            location.code = new_code
            location.barcode_value = new_code
            location.name = new_code
            location.sector = sector
            location.level = level_no
            location.row_no = row_no
            location.pallet_no = pallet_no
    new_data = {"code": location.code, "is_active": location.is_active}
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="location",
        entity_id=str(location_id),
        old_data=old_data,
        new_data=new_data,
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(location)
    return _to_location(location)


@router.delete("/{location_id}", response_model=LocationOut, summary="Deactivate or delete location")
async def deactivate_location(
    request: Request,
    location_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_permission("locations:manage")),
):
    location = db.query(LocationModel).filter(LocationModel.id == location_id).one_or_none()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    out = _to_location(location)
    old_data = {"code": location.code, "is_active": location.is_active, "name": location.name}
    if location.is_active:
        location.is_active = False
        log_action(
            db,
            user_id=user.id,
            action=ACTION_UPDATE,
            entity_type="location",
            entity_id=str(location_id),
            old_data=old_data,
            new_data={**old_data, "is_active": False},
            ip_address=get_client_ip(request),
        )
        db.commit()
        db.refresh(location)
        return _to_location(location)
    # Faol emas: bazadan butunlay o'chirish (hard delete)
    try:
        log_action(
            db,
            user_id=user.id,
            action=ACTION_DELETE,
            entity_type="location",
            entity_id=str(location_id),
            old_data=old_data,
            ip_address=get_client_ip(request),
        )
        db.delete(location)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Joylashuv hali ishlatilmoqda (inventar/hujjatda), o‘chirib bo‘lmaydi.",
        )
    return out
