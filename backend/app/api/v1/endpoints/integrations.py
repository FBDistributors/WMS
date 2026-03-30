from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.integrations.smartup.client import SmartupClient
from app.integrations.smartup.importer import import_orders
from app.integrations.smartup.sync_lock import smartup_sync_lock
from app.models.smartup_sync import SmartupSyncRun

router = APIRouter()


class SmartupImportRequest(BaseModel):
    begin_deal_date: Optional[date] = Field(default=None, description="YYYY-MM-DD (hozircha SmartUp ga yuborilmaydi)")
    end_deal_date: Optional[date] = Field(default=None, description="YYYY-MM-DD (hozircha SmartUp ga yuborilmaydi)")
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
    _user=Depends(require_permission("integrations:write")),
):
    if (
        payload.begin_deal_date is not None
        and payload.end_deal_date is not None
        and payload.begin_deal_date > payload.end_deal_date
    ):
        raise HTTPException(status_code=400, detail="begin_deal_date must be <= end_deal_date")

    with smartup_sync_lock(db) as acquired:
        if not acquired:
            raise HTTPException(
                status_code=409,
                detail="SmartUp sync already in progress. Try again later.",
            )
        run = SmartupSyncRun(
            run_type="orders",
            request_payload={
                "begin_deal_date": payload.begin_deal_date.isoformat() if payload.begin_deal_date else None,
                "end_deal_date": payload.end_deal_date.isoformat() if payload.end_deal_date else None,
                "filial_code": payload.filial_code,
            },
            params_json={
                "begin_deal_date": payload.begin_deal_date.isoformat() if payload.begin_deal_date else None,
                "end_deal_date": payload.end_deal_date.isoformat() if payload.end_deal_date else None,
                "filial_code": payload.filial_code,
            },
            status="running",
        )
        db.add(run)
        db.commit()
        db.refresh(run)

        try:
            client = SmartupClient()
            response = client.export_orders(filial_code=payload.filial_code)
            created, updated, skipped, errors, _ = import_orders(db, response.items)
        except Exception as exc:  # noqa: BLE001
            run.finished_at = datetime.utcnow()
            run.success_count = 0
            run.error_count = 1
            run.errors_json = [{"external_id": "smartup", "reason": str(exc)}]
            run.status = "failed"
            run.error_message = str(exc)
            db.add(run)
            db.commit()
            raise HTTPException(
                status_code=500,
                detail=f"Smartup import failed: {exc}",
            ) from exc

        run.finished_at = datetime.utcnow()
        run.success_count = created + updated
        run.error_count = len(errors)
        run.errors_json = [error.__dict__ for error in errors]
        run.inserted_count = created
        run.updated_count = updated
        run.skipped_count = skipped
        run.status = "success"
        db.add(run)
        db.commit()

        return SmartupImportResponse(
            created=created,
            updated=updated,
            skipped=skipped,
            errors=[error.__dict__ for error in errors],
        )


@router.get(
    "/smartup/order-export",
    summary="Export orders from SmartUp (raw response, no import)",
    response_model=None,
)
async def smartup_order_export_raw(
    begin_deal_date: Optional[date] = Query(
        None, description="(Rezerv) SmartUp ga hozircha yuborilmaydi"
    ),
    end_deal_date: Optional[date] = Query(None, description="(Rezerv) SmartUp ga hozircha yuborilmaydi"),
    filial_code: Optional[str] = Query(None, description="Filial code filter (Sync bilan bir xil)"),
    filial_id: Optional[str] = Query(None, description="Filial ID (Sync bilan bir xil)"),
    _user=Depends(require_permission("integrations:write")),
) -> dict[str, Any]:
    """SmartUp order$export dan to'g'ridan-to'g'ri javob (sana filtrlari yuborilmaydi, status=B#W)."""
    if begin_deal_date is not None and end_deal_date is not None and begin_deal_date > end_deal_date:
        raise HTTPException(status_code=400, detail="begin_deal_date must be <= end_deal_date")
    client = SmartupClient(filial_id=(filial_id or "").strip() or None)
    # begin_deal_date / end_deal_date query hozircha SmartUp ga yuborilmaydi (sinov).
    response = client.export_orders(filial_code=filial_code)
    orders_json = [o.model_dump(mode="json") for o in response.items]
    return {"order": orders_json, "total": len(orders_json)}
