"""Ish haqi tariflari — admin o'zi o'zgartiradi.

Tarif kodda emas bazada: o'zgartirish uchun deploy ham, ilova relizi ham kerak
emas, va hamma xodim ayni bir raqamni ko'radi.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import require_any_permission, require_permission
from app.db import get_db
from app.models.payroll_rate import (
    PAYROLL_GROUPS,
    PAYROLL_ROLES,
    PayrollBigOrderThreshold,
    PayrollRate,
)
from app.api.v1.endpoints.picking import _payroll_period_bounds
from app.core.business_time import BUSINESS_TZ
from app.services.audit_service import ACTION_UPDATE, log_action
from app.services.payroll_rates import DEFAULT_RATES, load_big_order_threshold, load_rates

router = APIRouter()


class PayrollRateOut(BaseModel):
    role: str
    source_group: str
    amount: float


class PayrollRatesResponse(BaseModel):
    rates: List[PayrollRateOut]
    #: Tahrir shu davrdan boshlab kuchga kiradi (oldingi davrlar tegilmaydi).
    effective_from: str
    #: Yirik buyurtma chegarasi (UZUM va h.k.): shu summadan ORTIQ — region tarif.
    big_order_threshold: float = 0.0


class PayrollRateUpdate(BaseModel):
    role: str
    source_group: str
    amount: Decimal = Field(..., ge=0)


class PayrollRatesUpdateRequest(BaseModel):
    rates: List[PayrollRateUpdate] = []
    #: Berilsa — yirik buyurtma chegarasi ham yangilanadi (joriy davrdan).
    big_order_threshold: Decimal | None = Field(default=None, ge=0)


@router.get("", response_model=PayrollRatesResponse, summary="Ish haqi tariflari")
@router.get("/", response_model=PayrollRatesResponse, summary="Ish haqi tariflari")
async def list_payroll_rates(
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
):
    """Joriy davrda amal qilayotgan tariflar."""
    period_from, _ = _payroll_period_bounds(datetime.now(BUSINESS_TZ).date())
    out: List[PayrollRateOut] = []
    for role in PAYROLL_ROLES:
        current = load_rates(db, role, period_from)
        for group in PAYROLL_GROUPS:
            amount = current.get(group, DEFAULT_RATES.get((role, group), Decimal("0")))
            out.append(PayrollRateOut(role=role, source_group=group, amount=float(amount)))
    return PayrollRatesResponse(
        rates=out,
        effective_from=period_from.isoformat(),
        big_order_threshold=float(load_big_order_threshold(db, period_from)),
    )


@router.put("", response_model=PayrollRatesResponse, summary="Tariflarni saqlash")
@router.put("/", response_model=PayrollRatesResponse, summary="Tariflarni saqlash")
async def update_payroll_rates(
    payload: PayrollRatesUpdateRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("admin:access")),
):
    for item in payload.rates:
        if item.role not in PAYROLL_ROLES:
            raise HTTPException(status_code=400, detail=f"Unknown role: {item.role}")
        if item.source_group not in PAYROLL_GROUPS:
            raise HTTPException(status_code=400, detail=f"Unknown group: {item.source_group}")

    # Yangi tarif joriy davr boshidan kuchga kiradi: o'tgan davrlar o'z qatorida
    # qoladi, ya'ni to'langan oy qayta hisoblanmaydi.
    period_from, _ = _payroll_period_bounds(datetime.now(BUSINESS_TZ).date())
    for item in payload.rates:
        row = (
            db.query(PayrollRate)
            .filter(
                PayrollRate.role == item.role,
                PayrollRate.source_group == item.source_group,
                PayrollRate.effective_from == period_from,
            )
            .one_or_none()
        )
        old = float(load_rates(db, item.role, period_from).get(item.source_group, 0))
        if row is None:
            row = PayrollRate(
                role=item.role,
                source_group=item.source_group,
                amount=item.amount,
                effective_from=period_from,
            )
            db.add(row)
        else:
            row.amount = item.amount
        row.updated_by_user_id = user.id
        # Ish haqiga ta'sir qiladi — kim, qachon, qanaqadan qanaqaga o'zgartirgani qolsin.
        log_action(
            db,
            user_id=user.id,
            action=ACTION_UPDATE,
            entity_type="payroll_rate",
            entity_id=f"{item.role}:{item.source_group}",
            old_data={"amount": old},
            new_data={"amount": float(item.amount), "effective_from": period_from.isoformat()},
        )

    # Yirik buyurtma chegarasi — tariflar bilan bir printsip: joriy davrdan, sanali.
    if payload.big_order_threshold is not None:
        old_threshold = float(load_big_order_threshold(db, period_from))
        row = (
            db.query(PayrollBigOrderThreshold)
            .filter(PayrollBigOrderThreshold.effective_from == period_from)
            .one_or_none()
        )
        if row is None:
            row = PayrollBigOrderThreshold(
                amount=payload.big_order_threshold, effective_from=period_from
            )
            db.add(row)
        else:
            row.amount = payload.big_order_threshold
        row.updated_by_user_id = user.id
        log_action(
            db,
            user_id=user.id,
            action=ACTION_UPDATE,
            entity_type="payroll_big_order_threshold",
            entity_id=period_from.isoformat(),
            old_data={"amount": old_threshold},
            new_data={
                "amount": float(payload.big_order_threshold),
                "effective_from": period_from.isoformat(),
            },
        )

    db.commit()
    return await list_payroll_rates(db=db, _user=user)
