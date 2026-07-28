"""Lokatsiyada yopiq quti joylashuvi API."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import require_any_permission, require_permission
from app.db import get_db
from app.models.user import User as UserModel
from app.services.audit_service import ACTION_UPDATE, get_client_ip, log_action
from app.services.box_location_service import (
    LocationBoxBreakdown,
    get_breakdown_tolerant,
    merge_box_type_at_location,
    place_sealed_boxes,
    reconcile_count,
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
    data_inconsistent: bool = False


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


class BoxMergeTypeIn(BaseModel):
    """Noto'g'ri shtrix-kod bilan qayd etilgan qutilarni to'g'ri turga o'tkazish."""

    from_box_barcode: str = Field(..., min_length=1, max_length=64)
    to_box_barcode: str = Field(..., min_length=1, max_length=64)
    location_id: UUID
    lot_id: UUID


class BoxMergeTypeOut(BaseModel):
    breakdown: BoxBreakdownOut
    #: Shu joyda ko'chirilgan quti soni.
    moved: int
    #: Manba turida boshqa joylarda qolgan qutilar — ish tugadimi yoki yo'q.
    remaining_elsewhere: int


class BoxCountIn(BaseModel):
    box_barcode: str = Field(..., min_length=1, max_length=64)
    location_id: UUID
    lot_id: UUID
    box_count: int = Field(..., ge=0, le=500)
    loose_units: int = Field(..., ge=0)


def _to_out(b: LocationBoxBreakdown) -> BoxBreakdownOut:
    return BoxBreakdownOut(
        product_id=b.product_id,
        lot_id=b.lot_id,
        location_id=b.location_id,
        box_count=b.box_count,
        units_in_boxes=b.units_in_boxes,
        loose_units=b.loose_units,
        total_units=b.total_units,
        data_inconsistent=b.data_inconsistent,
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
        get_breakdown_tolerant(
            db, product_id=product_id, lot_id=lot_id, location_id=location_id
        )
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


@router.post("/count", response_model=BoxBreakdownOut, summary="Inventarizatsiya: quti + dona sanog'i")
async def box_count(
    payload: BoxCountIn,
    db: Session = Depends(get_db),
    user: UserModel = Depends(require_permission("inventory:adjust")),
):
    result = reconcile_count(
        db,
        box_barcode=payload.box_barcode,
        location_id=payload.location_id,
        lot_id=payload.lot_id,
        user=user,
        box_count=payload.box_count,
        loose_units=payload.loose_units,
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


@router.post(
    "/merge-box-type",
    response_model=BoxMergeTypeOut,
    summary="Move sealed boxes from a wrong box barcode to the correct one",
)
async def box_merge_type(
    request: Request,
    payload: BoxMergeTypeIn,
    db: Session = Depends(get_db),
    user: UserModel = Depends(require_permission("inventory:adjust")),
):
    """Joydagi qutilarni noto'g'ri shtrix-koddan to'g'risiga o'tkazadi.

    Qayta yorliqlash: joylashuv yozuvining quti turi almashadi, fizik qoldiq
    tegilmaydi. Qutidagi dona soni ikkala turda bir xil bo'lishi shart.
    """
    result = merge_box_type_at_location(
        db,
        from_box_barcode=payload.from_box_barcode,
        to_box_barcode=payload.to_box_barcode,
        location_id=payload.location_id,
        lot_id=payload.lot_id,
    )
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="location_box_placement",
        entity_id=str(payload.location_id),
        ip_address=get_client_ip(request),
        old_data={"box_barcode": payload.from_box_barcode},
        new_data={
            "box_barcode": payload.to_box_barcode,
            "location_id": str(payload.location_id),
            "lot_id": str(payload.lot_id),
            "moved": result.moved,
            "remaining_elsewhere": result.remaining_elsewhere,
            "action": "merge_box_type",
        },
    )
    db.commit()
    return BoxMergeTypeOut(
        breakdown=_to_out(result.breakdown),
        moved=result.moved,
        remaining_elsewhere=result.remaining_elsewhere,
    )
