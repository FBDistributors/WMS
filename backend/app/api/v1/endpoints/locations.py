from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.models.location import (
    Location as LocationModel,
    parse_location_code,
    validate_location_code_format,
)

router = APIRouter()

LOCATION_TYPES = {"zone", "rack", "shelf", "bin"}
LOCATION_TYPE_ENUM = {"RACK", "FLOOR"}


class LocationOut(BaseModel):
    id: UUID
    code: str
    name: str
    type: str
    location_type: Optional[str] = None
    sector: Optional[str] = None
    level: Optional[int] = None
    row_no: Optional[int] = None
    pallet_no: Optional[int] = None
    parent_id: Optional[UUID] = None
    is_active: bool
    created_at: Optional[str] = None


class LocationCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    type: str = Field(..., min_length=1, max_length=32)
    location_type: Optional[str] = Field(default=None, max_length=32)  # RACK | FLOOR
    parent_id: Optional[UUID] = None
    is_active: bool = True


class LocationUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=64)
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    type: Optional[str] = Field(default=None, min_length=1, max_length=32)
    location_type: Optional[str] = Field(default=None, max_length=32)
    parent_id: Optional[UUID] = None
    is_active: Optional[bool] = None


def _to_location(location: LocationModel) -> LocationOut:
    return LocationOut(
        id=location.id,
        code=location.code,
        name=location.name,
        type=location.type,
        location_type=location.location_type,
        sector=location.sector,
        level=location.level,
        row_no=location.row_no,
        pallet_no=location.pallet_no,
        parent_id=location.parent_id,
        is_active=location.is_active,
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
    locations = query.order_by(LocationModel.code.asc()).all()
    return [_to_location(location) for location in locations]


def _apply_location_code_validation(code: str, location_type: str | None) -> dict:
    """Validate code format and return kwargs for sector, level, row_no, pallet_no if location_type is set."""
    try:
        validate_location_code_format(code, location_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if location_type:
        parsed_type, sector, level, row_no, pallet_no = parse_location_code(code)
        if parsed_type:
            return {
                "sector": sector,
                "level": level,
                "row_no": row_no,
                "pallet_no": pallet_no,
            }
    return {}


@router.post("", response_model=LocationOut, status_code=status.HTTP_201_CREATED, summary="Create location")
@router.post("/", response_model=LocationOut, status_code=status.HTTP_201_CREATED, summary="Create location")
async def create_location(
    payload: LocationCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("locations:manage")),
):
    if payload.type not in LOCATION_TYPES:
        raise HTTPException(status_code=400, detail="Invalid location type")
    code = payload.code.strip()
    loc_type = payload.location_type
    if loc_type is not None and loc_type not in LOCATION_TYPE_ENUM:
        raise HTTPException(status_code=400, detail="location_type must be RACK or FLOOR")
    existing = db.query(LocationModel).filter(LocationModel.code == code).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Location code already exists")

    # Infer location_type from code if it matches RACK/FLOOR format
    parsed_type, sector, level, row_no, pallet_no = parse_location_code(code)
    if parsed_type and loc_type is None:
        loc_type = parsed_type
    extra = _apply_location_code_validation(code, loc_type)
    if loc_type:
        extra["location_type"] = loc_type
    if parsed_type:
        extra.setdefault("sector", sector)
        extra.setdefault("level", level)
        extra.setdefault("row_no", row_no)
        extra.setdefault("pallet_no", pallet_no)

    parent_id = payload.parent_id
    if parent_id:
        parent = db.query(LocationModel).filter(LocationModel.id == parent_id).one_or_none()
        if not parent:
            raise HTTPException(status_code=400, detail="Parent location not found")

    location = LocationModel(
        code=code,
        name=payload.name,
        type=payload.type,
        parent_id=parent_id,
        is_active=payload.is_active,
        **extra,
    )
    db.add(location)
    db.commit()
    db.refresh(location)
    return _to_location(location)


@router.patch("/{location_id}", response_model=LocationOut, summary="Update location")
async def update_location(
    location_id: UUID,
    payload: LocationUpdate,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("locations:manage")),
):
    location = db.query(LocationModel).filter(LocationModel.id == location_id).one_or_none()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    if payload.type and payload.type not in LOCATION_TYPES:
        raise HTTPException(status_code=400, detail="Invalid location type")
    if payload.location_type is not None and payload.location_type not in LOCATION_TYPE_ENUM:
        raise HTTPException(status_code=400, detail="location_type must be RACK or FLOOR")

    new_code = payload.code.strip() if payload.code else None
    if new_code and new_code != location.code:
        existing = db.query(LocationModel).filter(LocationModel.code == new_code).one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail="Location code already exists")
        loc_type = payload.location_type if payload.location_type is not None else location.location_type
        _apply_location_code_validation(new_code, loc_type)
        location.code = new_code
        parsed_type, sector, level, row_no, pallet_no = parse_location_code(new_code)
        if parsed_type:
            location.location_type = parsed_type
            location.sector = sector
            location.level = level
            location.row_no = row_no
            location.pallet_no = pallet_no

    if payload.name is not None:
        location.name = payload.name
    if payload.type is not None:
        location.type = payload.type
    if payload.location_type is not None:
        location.location_type = payload.location_type
    if payload.is_active is not None:
        location.is_active = payload.is_active

    if payload.parent_id is not None:
        if payload.parent_id == location.id:
            raise HTTPException(status_code=400, detail="Parent cannot be self")
        if payload.parent_id:
            parent = db.query(LocationModel).filter(LocationModel.id == payload.parent_id).one_or_none()
            if not parent:
                raise HTTPException(status_code=400, detail="Parent location not found")
        location.parent_id = payload.parent_id

    db.commit()
    db.refresh(location)
    return _to_location(location)


@router.delete("/{location_id}", response_model=LocationOut, summary="Deactivate location")
async def deactivate_location(
    location_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("locations:manage")),
):
    location = db.query(LocationModel).filter(LocationModel.id == location_id).one_or_none()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    location.is_active = False
    db.commit()
    db.refresh(location)
    return _to_location(location)
