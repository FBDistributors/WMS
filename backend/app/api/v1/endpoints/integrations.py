from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.integrations.smartup.client import SmartupClient
from app.integrations.smartup.importer import import_orders

router = APIRouter()


class SmartupImportRequest(BaseModel):
    date_from: date = Field(..., description="YYYY-MM-DD")
    date_to: date = Field(..., description="YYYY-MM-DD")
    filial_code: Optional[str] = None


class SmartupImportResponse(BaseModel):
    created: int
    updated: int


@router.post("/smartup/import", response_model=SmartupImportResponse, summary="Import Smartup Orders")
async def import_smartup_orders(
    payload: SmartupImportRequest,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("admin:access")),
):
    if payload.date_from > payload.date_to:
        raise HTTPException(status_code=400, detail="date_from must be <= date_to")

    client = SmartupClient()
    response = client.export_orders(
        date_from=payload.date_from.isoformat(),
        date_to=payload.date_to.isoformat(),
        filial_code=payload.filial_code,
    )
    created, updated = import_orders(db, response.items)

    # TODO: Track import sync metadata per filial_code.
    return SmartupImportResponse(created=created, updated=updated)
