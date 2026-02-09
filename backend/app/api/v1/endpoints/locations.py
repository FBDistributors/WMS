from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.models.location import Location as LocationModel

router = APIRouter()

LOCATION_TYPES = {"zone", "rack", "shelf", "bin"}


class LocationOut(BaseModel):
    id: UUID
    code: str
    name: str
    type: str
    parent_id: Optional[UUID] = None
    is_active: bool


class LocationCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    type: str = Field(..., min_length=1, max_length=32)
    parent_id: Optional[UUID] = None
    is_active: bool = True


class LocationUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=64)
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    type: Optional[str] = Field(default=None, min_length=1, max_length=32)
    parent_id: Optional[UUID] = None
    is_active: Optional[bool] = None


def _to_location(location: LocationModel) -> LocationOut:
    return LocationOut(
        id=location.id,
        code=location.code,
        name=location.name,
        type=location.type,
        parent_id=location.parent_id,
        is_active=location.is_active,
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


@router.post("", response_model=LocationOut, status_code=status.HTTP_201_CREATED, summary="Create location")
@router.post("/", response_model=LocationOut, status_code=status.HTTP_201_CREATED, summary="Create location")
async def create_location(
    payload: LocationCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("locations:manage")),
):
    if payload.type not in LOCATION_TYPES:
        raise HTTPException(status_code=400, detail="Invalid location type")
    existing = db.query(LocationModel).filter(LocationModel.code == payload.code).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Location code already exists")

    parent_id = payload.parent_id
    if parent_id:
        parent = db.query(LocationModel).filter(LocationModel.id == parent_id).one_or_none()
        if not parent:
            raise HTTPException(status_code=400, detail="Parent location not found")

    location = LocationModel(
        code=payload.code,
        name=payload.name,
        type=payload.type,
        parent_id=parent_id,
        is_active=payload.is_active,
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

    if payload.code and payload.code != location.code:
        existing = db.query(LocationModel).filter(LocationModel.code == payload.code).one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail="Location code already exists")
        location.code = payload.code

    if payload.name is not None:
        location.name = payload.name
    if payload.type is not None:
        location.type = payload.type
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
