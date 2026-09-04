"""Umumiy sozlamalar API: sotuv muddat chegarasi va EXPIRED zona qoidasi.

GET — o'qish ruxsati bilan (Qoldiq sahifasi belgi chizish uchun ham o'qiydi);
PUT — faqat admin. O'zgarish auditga yoziladi.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.deps import require_any_permission, require_permission
from app.db import get_db
from app.services.app_settings import (
    get_expired_zone_in_regular_orders,
    get_sale_expiry_cutoff,
    set_expired_zone_in_regular_orders,
    set_sale_expiry_cutoff,
)
from app.services.audit_service import ACTION_UPDATE, log_action

router = APIRouter()


class SaleExpiryCutoffOut(BaseModel):
    #: ISO sana yoki null — qoida o'chiq.
    cutoff: Optional[str] = None


class SaleExpiryCutoffIn(BaseModel):
    cutoff: Optional[date] = None


@router.get("/sale-expiry-cutoff", response_model=SaleExpiryCutoffOut, summary="Sotuv muddat chegarasi")
async def get_cutoff(
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["inventory:read", "reports:read", "admin:access"])),
):
    cutoff = get_sale_expiry_cutoff(db)
    return SaleExpiryCutoffOut(cutoff=cutoff.isoformat() if cutoff else None)


@router.put("/sale-expiry-cutoff", response_model=SaleExpiryCutoffOut, summary="Chegarani saqlash")
async def put_cutoff(
    payload: SaleExpiryCutoffIn,
    db: Session = Depends(get_db),
    user=Depends(require_permission("admin:access")),
):
    old = get_sale_expiry_cutoff(db)
    set_sale_expiry_cutoff(db, payload.cutoff, user.id)
    # Sotuvga chiqish qoidasi — kim, qachon, qanaqadan qanaqaga o'zgartirgani qolsin.
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="app_setting",
        entity_id="sale_expiry_cutoff",
        old_data={"cutoff": old.isoformat() if old else None},
        new_data={"cutoff": payload.cutoff.isoformat() if payload.cutoff else None},
    )
    db.commit()
    return SaleExpiryCutoffOut(cutoff=payload.cutoff.isoformat() if payload.cutoff else None)


class ExpiredZoneRuleOut(BaseModel):
    #: True — oddiy buyurtmalar EXPIRED zonadan ham ajratiladi.
    enabled: bool = False


class ExpiredZoneRuleIn(BaseModel):
    enabled: bool


@router.get(
    "/expired-zone-in-regular-orders",
    response_model=ExpiredZoneRuleOut,
    summary="EXPIRED zona oddiy buyurtmalarda ishlatiladimi",
)
async def get_expired_zone_rule(
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["inventory:read", "reports:read", "admin:access"])),
):
    return ExpiredZoneRuleOut(enabled=get_expired_zone_in_regular_orders(db))


@router.put(
    "/expired-zone-in-regular-orders",
    response_model=ExpiredZoneRuleOut,
    summary="Qoidani yoqish/o'chirish",
)
async def put_expired_zone_rule(
    payload: ExpiredZoneRuleIn,
    db: Session = Depends(get_db),
    user=Depends(require_permission("admin:access")),
):
    old = get_expired_zone_in_regular_orders(db)
    set_expired_zone_in_regular_orders(db, payload.enabled, user.id)
    # Qaysi zaxira sotuvga chiqishini o'zgartiradi — kim, qachon yoqqani qolsin.
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="app_setting",
        entity_id="expired_zone_in_regular_orders",
        old_data={"enabled": old},
        new_data={"enabled": payload.enabled},
    )
    db.commit()
    return ExpiredZoneRuleOut(enabled=payload.enabled)
