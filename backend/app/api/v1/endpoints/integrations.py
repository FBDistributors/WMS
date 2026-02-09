from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.integrations.smartup.client import SmartupClient
from app.integrations.smartup.importer import import_orders
from app.models.smartup_sync import SmartupSyncRun

router = APIRouter()


class SmartupImportRequest(BaseModel):
    begin_deal_date: date = Field(..., description="YYYY-MM-DD")
    end_deal_date: date = Field(..., description="YYYY-MM-DD")
    filial_code: Optional[str] = None


class SmartupImportResponse(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[dict]


@router.post("/smartup/import", response_model=SmartupImportResponse, summary="Import Smartup Orders")
async def import_smartup_orders(
    payload: SmartupImportRequest,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("admin:access")),
):
    if payload.begin_deal_date > payload.end_deal_date:
        raise HTTPException(status_code=400, detail="begin_deal_date must be <= end_deal_date")

    run = SmartupSyncRun(
        params_json={
            "begin_deal_date": payload.begin_deal_date.isoformat(),
            "end_deal_date": payload.end_deal_date.isoformat(),
            "filial_code": payload.filial_code,
        }
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        client = SmartupClient()
        response = client.export_orders(
            begin_deal_date=payload.begin_deal_date.strftime("%d.%m.%Y"),
            end_deal_date=payload.end_deal_date.strftime("%d.%m.%Y"),
            filial_code=payload.filial_code,
        )
        created, updated, skipped, errors = import_orders(db, response.items)
    except Exception as exc:  # noqa: BLE001
        run.finished_at = datetime.utcnow()
        run.success_count = 0
        run.error_count = 1
        run.errors_json = [{"external_id": "smartup", "reason": str(exc)}]
        db.add(run)
        db.commit()
        raise HTTPException(status_code=500, detail="Smartup import failed") from exc

    run.finished_at = datetime.utcnow()
    run.success_count = created + updated
    run.error_count = len(errors)
    run.errors_json = [error.__dict__ for error in errors]
    db.add(run)
    db.commit()

    return SmartupImportResponse(
        created=created,
        updated=updated,
        skipped=skipped,
        errors=[error.__dict__ for error in errors],
    )
