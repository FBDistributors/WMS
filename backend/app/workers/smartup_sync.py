"""
SmartUp ERP synchronization worker.

Runs as a separate background process, periodically syncing products and orders
from SmartUp API into PostgreSQL. Idempotent, safe for retries.
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Tuple

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.integrations.smartup.client import SmartupClient
from app.integrations.smartup.importer import import_orders
from app.integrations.smartup.inventory_client import SmartupInventoryExportClient
from app.integrations.smartup.products_sync import _sync_products
from app.models.smartup_sync import SmartupSyncRun

logger = logging.getLogger(__name__)

# Status constants
STATUS_SUCCESS = "SUCCESS"
STATUS_FAILED = "FAILED"
STATUS_PARTIAL = "PARTIAL"


def _get_orders_date_range() -> Tuple[date, date]:
    """Get date range for order sync (last N days)."""
    days = int(os.getenv("SYNC_ORDERS_DAYS_BACK", "7"))
    days = max(1, min(days, 90))
    end_date = date.today()
    start_date = end_date - timedelta(days=days)
    return start_date, end_date


def sync_products(db: Session) -> Tuple[int, str | None]:
    """
    Fetch products from SmartUp API and upsert into products table.
    Returns (count_synced, error_message).
    """
    try:
        client = SmartupInventoryExportClient()
        payload = {
            "code": "",
            "begin_created_on": "",
            "end_created_on": "",
            "begin_modified_on": "",
            "end_modified_on": "",
        }
        response = client.export_inventory(payload)
        items = response.get("inventory") or []

        inserted, updated, skipped, errors = _sync_products(db, items)
        count = inserted + updated

        if errors:
            logger.warning("Products sync: %d errors (first: %s)", len(errors), errors[0].reason)
        logger.info(
            "Products sync: inserted=%d updated=%d skipped=%d errors=%d",
            inserted,
            updated,
            skipped,
            len(errors),
        )
        return count, None
    except Exception as exc:
        logger.exception("Products sync failed: %s", exc)
        return 0, str(exc)


def sync_orders(db: Session) -> Tuple[int, str | None]:
    """
    Fetch orders from SmartUp API and upsert into orders table.
    Returns (count_synced, error_message).
    """
    try:
        start_date, end_date = _get_orders_date_range()
        client = SmartupClient()
        response = client.export_orders(
            begin_deal_date=start_date.strftime("%d.%m.%Y"),
            end_deal_date=end_date.strftime("%d.%m.%Y"),
            filial_code=None,
        )

        created, updated, skipped, errors = import_orders(db, response.items)
        count = created + updated

        if errors:
            logger.warning("Orders sync: %d errors (first: %s)", len(errors), errors[0].reason)
        logger.info(
            "Orders sync: created=%d updated=%d skipped=%d errors=%d",
            created,
            updated,
            skipped,
            len(errors),
        )
        return count, None
    except Exception as exc:
        logger.exception("Orders sync failed: %s", exc)
        return 0, str(exc)


def run_full_sync() -> SmartupSyncRun | None:
    """
    Run full SmartUp sync: products, then orders.
    Creates sync_run record, handles errors, does not raise.
    """
    db = SessionLocal()
    run: SmartupSyncRun | None = None
    start_time = datetime.now(timezone.utc)

    try:
        run = SmartupSyncRun(
            run_type="full",
            request_payload={"started_at": start_time.isoformat()},
            params_json={},
            status="running",
        )
        db.add(run)
        db.commit()
        db.refresh(run)

        logger.info("SmartUp full sync started", extra={"run_id": str(run.id)})

        products_count = 0
        orders_count = 0
        products_error: str | None = None
        orders_error: str | None = None

        # Sync products
        try:
            products_count, products_error = sync_products(db)
        except Exception as exc:
            products_error = str(exc)
            logger.exception("Products sync raised: %s", exc)

        # Sync orders (even if products failed)
        try:
            orders_count, orders_error = sync_orders(db)
        except Exception as exc:
            orders_error = str(exc)
            logger.exception("Orders sync raised: %s", exc)

        # Determine status
        if products_error and orders_error:
            status = STATUS_FAILED
            error_message = f"Products: {products_error}; Orders: {orders_error}"
        elif products_error or orders_error:
            status = STATUS_PARTIAL
            error_message = products_error or orders_error or ""
        else:
            status = STATUS_SUCCESS
            error_message = None

        # Update sync run
        run.finished_at = datetime.now(timezone.utc)
        run.status = status
        run.error_message = error_message[:512] if error_message else None
        run.synced_products_count = products_count
        run.synced_orders_count = orders_count
        run.inserted_count = products_count
        run.updated_count = orders_count
        run.success_count = products_count + orders_count

        if products_error:
            run.error_count = (run.error_count or 0) + 1
            run.errors_json = run.errors_json or []
            run.errors_json.append({"step": "products", "reason": products_error})
        if orders_error:
            run.error_count = (run.error_count or 0) + 1
            run.errors_json = run.errors_json or []
            run.errors_json.append({"step": "orders", "reason": orders_error})

        db.add(run)
        db.commit()

        duration_sec = (run.finished_at - start_time).total_seconds()
        logger.info(
            "SmartUp full sync finished: status=%s products=%d orders=%d duration_sec=%.1f",
            status,
            products_count,
            orders_count,
            duration_sec,
        )
        return run

    except Exception as exc:
        logger.exception("SmartUp full sync failed: %s", exc)
        if run:
            try:
                run.finished_at = datetime.now(timezone.utc)
                run.status = STATUS_FAILED
                run.error_message = str(exc)[:512]
                db.add(run)
                db.commit()
            except Exception as commit_exc:
                logger.exception("Failed to update sync run: %s", commit_exc)
        return run
    finally:
        db.close()
