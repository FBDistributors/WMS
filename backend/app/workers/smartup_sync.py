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

from app.db import SessionLocal
from app.integrations.smartup.client import SmartupClient
from app.integrations.smartup.importer import delete_stale_orders, filter_orders_b_s, import_orders
from app.integrations.smartup.inventory_client import SmartupInventoryExportClient
from app.integrations.smartup.products_sync import _sync_products
from app.integrations.smartup.sync_lock import smartup_sync_lock
from app.models.smartup_sync import SmartupSyncRun

logger = logging.getLogger(__name__)

# Status constants
STATUS_SUCCESS = "SUCCESS"
STATUS_FAILED = "FAILED"
STATUS_PARTIAL = "PARTIAL"


def _get_orders_date_range() -> Tuple[date, date]:
    """Get date range for order sync (last N days). Default 7 — oxirgi 7 kun o'zgarishlari."""
    days = int(os.getenv("SYNC_ORDERS_DAYS_BACK", "7"))
    days = max(1, min(days, 90))
    end_date = date.today()
    start_date = end_date - timedelta(days=days)
    return start_date, end_date


def sync_products() -> Tuple[int, str | None, list]:
    """
    Fetch products from SmartUp API and upsert into products table.
    HTTP chaqiruvi session ochiq bo'lmaganda bajariladi, keyin qisqa session bilan import (pool band qilmaslik).
    Returns (count_synced, exception_message, list of SyncError dicts).
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

        db = SessionLocal()
        try:
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
            return count, None, [e.__dict__ for e in errors]
        finally:
            db.close()
    except Exception as exc:
        logger.exception("Products sync failed: %s", exc)
        return 0, str(exc), []


def sync_orders() -> Tuple[int, str | None, list]:
    """
    Fetch orders from SmartUp API and upsert into orders table.
    Oxirgi N kun (SYNC_ORDERS_DAYS_BACK) o'zgartirilgan buyurtmalar — modified_on orqali bitta so'rov.
    """
    try:
        start_date, end_date = _get_orders_date_range()
        client = SmartupClient()
        begin_str = start_date.strftime("%d.%m.%Y")
        end_str = end_date.strftime("%d.%m.%Y")
        response = client.export_orders(
            begin_deal_date=begin_str,
            end_deal_date=end_str,
            filial_code=None,
            begin_modified_on=begin_str,
            end_modified_on=end_str,
        )
        all_items = response.items
        items_b_s = filter_orders_b_s(all_items)
        logger.info(
            "Orders sync: %s..%s -> %d buyurtma (modified_on), %d B#W",
            begin_str, end_str, len(all_items), len(items_b_s),
        )

        db = SessionLocal()
        try:
            created, updated, skipped, errors, _ = import_orders(db, items_b_s)
            stale_deleted = delete_stale_orders(db, items_b_s)
            count = created + updated
            if errors:
                logger.warning("Orders sync: %d errors (first: %s)", len(errors), errors[0].reason)
            logger.info(
                "Orders sync: created=%d updated=%d skipped=%d errors=%d stale_deleted=%d",
                created,
                updated,
                skipped,
                len(errors),
                stale_deleted,
            )
            return count, None, [e.__dict__ for e in errors]
        finally:
            db.close()
    except Exception as exc:
        logger.exception("Orders sync failed: %s", exc)
        return 0, str(exc), []


def run_full_sync() -> SmartupSyncRun | None:
    """
    Run full SmartUp sync: products, then orders.
    Uses advisory lock so only one full/orders sync runs at a time (worker vs HTTP).
    """
    run_id = None
    start_time = datetime.now(timezone.utc)
    lock_db = SessionLocal()
    try:
        with smartup_sync_lock(lock_db) as acquired:
            if not acquired:
                return None
            try:
                db = SessionLocal()
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
                    run_id = run.id
                finally:
                    db.close()

                logger.info("SmartUp full sync started", extra={"run_id": str(run_id)})

                products_count = 0
                orders_count = 0
                products_error = None
                orders_error = None
                products_errors = []
                orders_errors = []

                try:
                    products_count, products_error, products_errors = sync_products()
                except Exception as exc:
                    products_error = str(exc)
                    products_errors = []
                    logger.exception("Products sync raised: %s", exc)

                try:
                    orders_count, orders_error, orders_errors = sync_orders()
                except Exception as exc:
                    orders_error = str(exc)
                    orders_errors = []
                    logger.exception("Orders sync raised: %s", exc)

                if products_error and orders_error:
                    status = STATUS_FAILED
                    error_message = f"Products: {products_error}; Orders: {orders_error}"
                elif products_error or orders_error:
                    status = STATUS_PARTIAL
                    error_message = products_error or orders_error or ""
                else:
                    status = STATUS_SUCCESS
                    error_message = None

                all_errors = []
                if products_error:
                    all_errors.append({"step": "products", "reason": products_error})
                for e in products_errors:
                    all_errors.append({"step": "products", "external_id": e.get("external_id"), "reason": e.get("reason")})
                if orders_error:
                    all_errors.append({"step": "orders", "reason": orders_error})
                for e in orders_errors:
                    all_errors.append({"step": "orders", "external_id": e.get("external_id"), "reason": e.get("reason")})

                db = SessionLocal()
                try:
                    run = db.get(SmartupSyncRun, run_id)
                    if run:
                        run.finished_at = datetime.now(timezone.utc)
                        run.status = status
                        run.error_message = error_message[:512] if error_message else None
                        run.synced_products_count = products_count
                        run.synced_orders_count = orders_count
                        run.inserted_count = products_count
                        run.updated_count = orders_count
                        run.success_count = products_count + orders_count
                        run.error_count = len(all_errors)
                        run.errors_json = all_errors
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
                finally:
                    db.close()
                return None
            except Exception as exc:
                logger.exception("SmartUp full sync failed: %s", exc)
                if run_id is not None:
                    db = SessionLocal()
                    try:
                        run = db.get(SmartupSyncRun, run_id)
                        if run:
                            run.finished_at = datetime.now(timezone.utc)
                            run.status = STATUS_FAILED
                            run.error_message = str(exc)[:512]
                            db.add(run)
                            db.commit()
                            return run
                    except Exception as commit_exc:
                        logger.exception("Failed to update sync run: %s", commit_exc)
                    finally:
                        db.close()
                return None
    finally:
        lock_db.close()
