from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.models.brand import Brand as BrandModel
from app.models.product import Product as ProductModel

router = APIRouter()


class BrandOut(BaseModel):
    id: UUID
    code: str
    name: str
    display_name: Optional[str] = None
    is_active: bool


class BrandCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=16)
    name: str = Field(..., min_length=1, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=128)
    is_active: bool = True


class BrandUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=16)
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=128)
    is_active: Optional[bool] = None


def _to_brand(brand: BrandModel) -> BrandOut:
    return BrandOut(
        id=brand.id,
        code=brand.code,
        name=brand.name,
        display_name=brand.display_name,
        is_active=brand.is_active,
    )


@router.get("", response_model=List[BrandOut], summary="List brands")
@router.get("/", response_model=List[BrandOut], summary="List brands")
async def list_brands(
    search: Optional[str] = None,
    include_inactive: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("admin:access")),
):
    query = db.query(BrandModel)
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            BrandModel.code.ilike(term)
            | BrandModel.name.ilike(term)
            | BrandModel.display_name.ilike(term)
        )
    if not include_inactive:
        query = query.filter(BrandModel.is_active.is_(True))
    brands = (
        query.order_by(BrandModel.code.asc()).offset(offset).limit(limit).all()
    )
    return [_to_brand(brand) for brand in brands]


@router.post("", response_model=BrandOut, status_code=status.HTTP_201_CREATED, summary="Create brand")
@router.post("/", response_model=BrandOut, status_code=status.HTTP_201_CREATED, summary="Create brand")
async def create_brand(
    payload: BrandCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("brands:manage")),
):
    existing = db.query(BrandModel).filter(BrandModel.code == payload.code).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Brand code already exists")
    brand = BrandModel(
        code=payload.code.strip(),
        name=payload.name.strip(),
        display_name=payload.display_name.strip() if payload.display_name else None,
        is_active=payload.is_active,
    )
    db.add(brand)
    db.commit()
    db.refresh(brand)
    return _to_brand(brand)


@router.put("/{brand_id}", response_model=BrandOut, summary="Update brand")
async def update_brand(
    brand_id: UUID,
    payload: BrandUpdate,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("brands:manage")),
):
    brand = db.query(BrandModel).filter(BrandModel.id == brand_id).one_or_none()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")

    if payload.code and payload.code != brand.code:
        existing = db.query(BrandModel).filter(BrandModel.code == payload.code).one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail="Brand code already exists")
        brand.code = payload.code.strip()
    if payload.name is not None:
        brand.name = payload.name.strip()
    if payload.display_name is not None:
        brand.display_name = payload.display_name.strip() or None
    if payload.is_active is not None:
        brand.is_active = payload.is_active

    db.commit()
    db.refresh(brand)
    return _to_brand(brand)


@router.delete("/{brand_id}", response_model=BrandOut, summary="Deactivate brand")
async def delete_brand(
    brand_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("brands:manage")),
):
    brand = db.query(BrandModel).filter(BrandModel.id == brand_id).one_or_none()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    brand.is_active = False
    db.commit()
    db.refresh(brand)
    return _to_brand(brand)


@router.get("/unknown-codes", response_model=List[str], summary="Unknown brand codes")
async def unknown_brand_codes(
    db: Session = Depends(get_db),
    _user=Depends(require_permission("brands:manage")),
):
    rows = (
        db.query(func.distinct(ProductModel.brand_code))
        .filter(ProductModel.brand_code.is_not(None), ProductModel.brand_id.is_(None))
        .order_by(ProductModel.brand_code.asc())
        .all()
    )
    return [row[0] for row in rows if row[0]]
