"""Lokatsiyada yopiq quti joylashuvi API."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import require_any_permission, require_permission
from app.db import get_db
from app.models.user import User as UserModel
from app.services.box_location_service import (
    LocationBoxBreakdown,
    get_breakdown,
    place_sealed_boxes,
    relocate_sealed_box,
    remove_sealed_box,
)

router = APIRouter()


class SealedBoxOut(BaseModel):
    placement_id: UUID
    product_box_id: UUID
    box_barcode: str
    units_per_box: int
    label: str | None = None


class BoxBreakdownOut(BaseModel):
    product_id: UUID
    lot_id: UUID
    location_id: UUID
    box_count: int
    units_in_boxes: int
    loose_units: int
    total_units: int
    sealed_boxes: list[SealedBoxOut]


class BoxPlaceIn(BaseModel):
    box_barcode: str = Field(..., min_length=1, max_length=64)
    location_id: UUID
    lot_id: UUID
    box_count: int = Field(default=1, ge=1, le=500)


class BoxRemoveIn(BaseModel):
    box_barcode: str = Field(..., min_length=1, max_length=64)
    location_id: UUID | None = None
    lot_id: UUID | None = None
    reason: str = Field(default="inventory", max_length=64)


class BoxTransferIn(BaseModel):
    box_barcode: str = Field(..., min_length=1, max_length=64)
    from_location_id: UUID
    to_location_id: UUID


def _to_out(b: LocationBoxBreakdown) -> BoxBreakdownOut:
    return BoxBreakdownOut(
        product_id=b.product_id,
        lot_id=b.lot_id,
        location_id=b.location_id,
        box_count=b.box_count,
        units_in_boxes=b.units_in_boxes,
        loose_units=b.loose_units,
        total_units=b.total_units,
        sealed_boxes=[
            SealedBoxOut(
                placement_id=s.placement_id,
                product_box_id=s.product_box_id,
                box_barcode=s.box_barcode,
                units_per_box=s.units_per_box,
                label=s.label,
            )
            for s in b.sealed_boxes
        ],
    )


@router.get("/breakdown", response_model=BoxBreakdownOut, summary="Lokatsiya quti/qutisiz breakdown")
async def box_breakdown(
    product_id: UUID = Query(...),
    lot_id: UUID = Query(...),
    location_id: UUID = Query(...),
    db: Session = Depends(get_db),
    _user: UserModel = Depends(
        require_any_permission(["inventory:read", "picking:read", "products:read"])
    ),
):
    return _to_out(
        get_breakdown(db, product_id=product_id, lot_id=lot_id, location_id=location_id)
    )


@router.post("/place", response_model=BoxBreakdownOut, status_code=status.HTTP_201_CREATED)
async def box_place(
    payload: BoxPlaceIn,
    db: Session = Depends(get_db),
    user: UserModel = Depends(
        require_any_permission(["inventory:adjust", "receiving:write", "products:write"])
    ),
):
    result = place_sealed_boxes(
        db,
        box_barcode=payload.box_barcode,
        location_id=payload.location_id,
        lot_id=payload.lot_id,
        user=user,
        box_count=payload.box_count,
    )
    db.commit()
    return _to_out(result)


@router.post("/remove", response_model=BoxBreakdownOut)
async def box_remove(
    payload: BoxRemoveIn,
    db: Session = Depends(get_db),
    user: UserModel = Depends(
        require_any_permission(["inventory:adjust", "picking:pick", "receiving:write"])
    ),
):
    result = remove_sealed_box(
        db,
        box_barcode=payload.box_barcode,
        user=user,
        reason=payload.reason,
        location_id=payload.location_id,
        lot_id=payload.lot_id,
    )
    db.commit()
    return _to_out(result)


@router.post("/transfer", response_model=BoxBreakdownOut)
async def box_transfer(
    payload: BoxTransferIn,
    db: Session = Depends(get_db),
    user: UserModel = Depends(require_permission("inventory:adjust")),
):
    if payload.from_location_id == payload.to_location_id:
        raise HTTPException(status_code=400, detail="Manba va manzil bir xil")
    result = relocate_sealed_box(
        db,
        box_barcode=payload.box_barcode,
        to_location_id=payload.to_location_id,
        user=user,
        from_location_id=payload.from_location_id,
    )
    db.commit()
    return _to_out(result)
