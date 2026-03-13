from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import require_any_permission, require_permission
from app.db import get_db
from app.models.stock import StockMovement as StockMovementModel
from app.models.stock import ON_HAND_MOVEMENT_TYPES
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

LOCATION_TYPE_ENUM = {"RACK", "FLOOR", "SHOWROOM_RACK"}


def _get_showroom_root_id(db: Session) -> Optional[UUID]:
    """Return the id of the Showroom warehouse root location, or None if not found."""
    row = (
        db.query(LocationModel.id)
        .filter(LocationModel.code == "SHOWROOM", LocationModel.type == "warehouse")
        .one_or_none()
    )
    return row[0] if row else None


class LocationOut(BaseModel):
    id: UUID
    code: str
    barcode_value: str
    name: str
    type: str
    location_type: Optional[str] = None
    zone_type: str = "NORMAL"
    sector: Optional[str] = None
    level_no: Optional[int] = None
    row_no: Optional[int] = None
    pallet_no: Optional[int] = None
    parent_id: Optional[UUID] = None
    warehouse_id: Optional[UUID] = None
    is_active: bool
    pick_sequence: Optional[int] = None
    created_at: Optional[str] = None


class LocationCreate(BaseModel):
    """Create location by type. Code is generated server-side."""

    location_type: str = Field(..., description="RACK, FLOOR or SHOWROOM_RACK")
    sector: str = Field(..., min_length=1, max_length=64)
    level_no: Optional[int] = Field(default=None, ge=0, le=99)
    row_no: Optional[int] = Field(default=None, ge=0, le=99)
    pallet_no: Optional[int] = Field(default=None, ge=0, le=99)
    is_active: bool = True
    warehouse_id: Optional[UUID] = Field(default=None, description="Set for showroom locations (showroom root id)")


class LocationUpdate(BaseModel):
    """Update location. For RACK/FLOOR, pass sector/level_no/row_no or pallet_no to regenerate code."""

    sector: Optional[str] = Field(default=None, min_length=1, max_length=64)
    level_no: Optional[int] = Field(default=None, ge=0, le=99)
    row_no: Optional[int] = Field(default=None, ge=0, le=99)
    pallet_no: Optional[int] = Field(default=None, ge=0, le=99)
    is_active: Optional[bool] = None
    pick_sequence: Optional[int] = Field(default=None, ge=0, description="Terish ketma-ketligi (yo'nalish)")
    zone_type: Optional[str] = Field(default=None, description="NORMAL, EXPIRED, DAMAGED, QUARANTINE")


def _to_location(location: LocationModel) -> LocationOut:
    return LocationOut(
        id=location.id,
        code=location.code,
        barcode_value=location.barcode_value or location.code,
        name=location.name,
        type=location.type,
        location_type=location.location_type,
        zone_type=location.zone_type or "NORMAL",
        sector=location.sector,
        level_no=location.level,
        row_no=location.row_no,
        pallet_no=location.pallet_no,
        parent_id=location.parent_id,
        warehouse_id=location.warehouse_id,
        is_active=location.is_active,
        pick_sequence=location.pick_sequence,
        created_at=location.created_at.isoformat() if location.created_at else None,
    )


@router.get("", response_model=List[LocationOut], summary="List locations")
@router.get("/", response_model=List[LocationOut], summary="List locations")
async def list_locations(
    include_inactive: bool = Query(False),
    warehouse: Optional[str] = Query(None, description="main (warehouse_id IS NULL) or showroom"),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["locations:read", "locations:manage"])),
):
    query = db.query(LocationModel)
    if not include_inactive:
        query = query.filter(LocationModel.is_active.is_(True))
    if warehouse == "main":
        query = query.filter(LocationModel.warehouse_id.is_(None))
    elif warehouse == "showroom":
        showroom_id = _get_showroom_root_id(db)
        if showroom_id is None:
            return []
        query = query.filter(LocationModel.warehouse_id == showroom_id)
    # Exclude the Showroom root itself from list (it has type=warehouse, we list only actual locations)
    query = query.filter(LocationModel.type != "warehouse")
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
    _user=Depends(require_any_permission(["locations:read", "locations:manage"])),
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
    user=Depends(require_any_permission(["locations:write", "locations:manage"])),
):
    if payload.location_type not in LOCATION_TYPE_ENUM:
        raise HTTPException(status_code=400, detail="location_type must be RACK, FLOOR or SHOWROOM_RACK")
    warehouse_id = payload.warehouse_id
    if payload.location_type == "SHOWROOM_RACK":
        showroom_id = _get_showroom_root_id(db)
        if showroom_id is None:
            raise HTTPException(
                status_code=400,
                detail="Showroom warehouse not found. Run seed to create SHOWROOM root location.",
            )
        warehouse_id = showroom_id
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
    if payload.location_type == "RACK":
        type_normalized = "rack"
    elif payload.location_type == "SHOWROOM_RACK":
        type_normalized = "showroom_rack"
    else:
        type_normalized = "floor"
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
        warehouse_id=warehouse_id,
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
    user=Depends(require_any_permission(["locations:write", "locations:manage"])),
):
    location = db.query(LocationModel).filter(LocationModel.id == location_id).one_or_none()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    ZONE_TYPES = ("NORMAL", "EXPIRED", "DAMAGED", "QUARANTINE")
    old_data = {"code": location.code, "is_active": location.is_active}
    if payload.zone_type is not None:
        old_data["zone_type"] = location.zone_type
    if payload.is_active is not None:
        location.is_active = payload.is_active
    if payload.zone_type is not None:
        if payload.zone_type not in ZONE_TYPES:
            raise HTTPException(status_code=400, detail=f"zone_type must be one of {ZONE_TYPES}")
        location.zone_type = payload.zone_type
    if "pick_sequence" in payload.model_dump(exclude_unset=True):
        location.pick_sequence = payload.pick_sequence
    if location.location_type in LOCATION_TYPE_ENUM and (
        payload.sector is not None or payload.level_no is not None or payload.row_no is not None or payload.pallet_no is not None
    ):
        sector = payload.sector if payload.sector is not None else (location.sector or "")
        level_no = payload.level_no if payload.level_no is not None else location.level
        row_no = payload.row_no if payload.row_no is not None else location.row_no
        pallet_no = payload.pallet_no if payload.pallet_no is not None else location.pallet_no
        if location.location_type == "SHOWROOM_RACK":
            row_no = None
            pallet_no = None
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
    if payload.zone_type is not None:
        new_data["zone_type"] = location.zone_type
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
    user=Depends(require_any_permission(["locations:write", "locations:manage"])),
):
    location = db.query(LocationModel).filter(LocationModel.id == location_id).one_or_none()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    out = _to_location(location)
    old_data = {"code": location.code, "is_active": location.is_active, "name": location.name}
    if location.is_active:
        # Joyda qoldiq (on_hand) bo'lsa faolsizlantirishni taqiqlash
        on_hand = (
            db.query(func.coalesce(func.sum(StockMovementModel.qty_change), 0))
            .filter(
                StockMovementModel.location_id == location_id,
                StockMovementModel.movement_type.in_(ON_HAND_MOVEMENT_TYPES),
            )
            .scalar()
        )
        if on_hand is not None and float(on_hand) != 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Joyda mahsulot qoldig'i bor. Avval inventarni boshqa joyga ko'chiring yoki chiqaring.",
            )
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
