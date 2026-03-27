from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.integrations.smartup.client import SmartupClient
from app.integrations.smartup.importer import filter_orders_b_w, import_orders
from app.integrations.smartup.sync_lock import smartup_sync_lock
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
    _user=Depends(require_permission("integrations:write")),
):
    if payload.begin_deal_date > payload.end_deal_date:
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
                "begin_deal_date": payload.begin_deal_date.isoformat(),
                "end_deal_date": payload.end_deal_date.isoformat(),
                "filial_code": payload.filial_code,
            },
            params_json={
                "begin_deal_date": payload.begin_deal_date.isoformat(),
                "end_deal_date": payload.end_deal_date.isoformat(),
                "filial_code": payload.filial_code,
            },
            status="running",
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
            items_b_w = filter_orders_b_w(response.items)
            created, updated, skipped, errors, _ = import_orders(db, items_b_w)
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
    begin_deal_date: Optional[date] = Query(None, description="YYYY-MM-DD (default: 7 days ago)"),
    end_deal_date: Optional[date] = Query(None, description="YYYY-MM-DD (default: today)"),
    filial_code: Optional[str] = Query(None, description="Filial code filter (Sync bilan bir xil)"),
    filial_id: Optional[str] = Query(None, description="Filial ID (Sync bilan bir xil)"),
    _user=Depends(require_permission("integrations:write")),
) -> dict[str, Any]:
    """SmartUp order$export dan to'g'ridan-to'g'ri javobni qaytaradi (bazaga yozmaydi). Sync bilan bir xil parametrlar."""
    today = date.today()
    end = end_deal_date or today
    begin = begin_deal_date or (today - timedelta(days=7))
    if begin > end:
        raise HTTPException(status_code=400, detail="begin_deal_date must be <= end_deal_date")
    client = SmartupClient(filial_id=(filial_id or "").strip() or None)
    response = client.export_orders(
        begin_deal_date=begin.strftime("%d.%m.%Y"),
        end_deal_date=end.strftime("%d.%m.%Y"),
        filial_code=filial_code,
        begin_modified_on=begin.strftime("%d.%m.%Y"),
        end_modified_on=end.strftime("%d.%m.%Y"),
    )
    items_b_w = filter_orders_b_w(response.items)
    orders_json = [o.model_dump(mode="json") for o in items_b_w]
    return {"order": orders_json, "total": len(orders_json)}
