from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.integrations.smartup.inventory_client import SmartupInventoryExportClient
from app.models.brand import Brand
from app.models.product import Product, ProductBarcode
from app.models.smartup_sync import SmartupSyncRun


@dataclass
class SyncError:
    external_id: str
    reason: str
    sku: str | None = None
    barcode: str | None = None


def _normalize_barcode(raw: str | None) -> tuple[str | None, list[str]]:
    if not raw:
        return None, []
    tokens = [token.strip() for token in raw.replace(";", ",").replace(" ", ",").split(",")]
    normalized = []
    for token in tokens:
        if not token:
            continue
        digits = "".join(ch for ch in token if ch.isdigit())
        if digits:
            normalized.append(digits)
    primary = normalized[0] if normalized else None
    return primary, normalized


def _is_active_state(value: object) -> bool:
    if value is None:
        return False
    return str(value).strip().upper() == "A"


def _truncate(value: str | None, max_len: int) -> str | None:
    """Truncate string to max_len to avoid StringDataRightTruncation."""
    if value is None:
        return None
    s = str(value).strip()
    return s[:max_len] if len(s) > max_len else s or None


def _extract_brand_code(groups: list | None) -> str | None:
    if not groups:
        return None
    for group in groups:
        if not isinstance(group, dict):
            continue
        group_id = group.get("group_id") or group.get("id")
        if str(group_id) != "31426":
            continue
        raw_code = group.get("type_code") or group.get("code")
        if raw_code is None:
            return None
        code = "".join(ch for ch in str(raw_code).strip() if ch.isdigit())
        if not code:
            return None
        return code.zfill(3)
    return None


def _process_one_product(
    db: Session,
    item: dict,
    unknown_codes: set[str],
    errors: list[SyncError],
    max_errors: int,
    do_commit: bool,
) -> Tuple[int, int, int]:
    """Process one product. Returns (inserted_inc, updated_inc, skipped_inc). On error appends to errors and returns (0,0,1)."""
    external_id = str(item.get("product_id") or "").strip()
    if not external_id:
        return 0, 0, 1
    code = str(item.get("code") or "").strip()
    name = _truncate(item.get("name"), 512) or ""
    if not code or not name:
        return 0, 0, 1
    is_active = _is_active_state(item.get("state"))
    barcode_primary, barcode_list = _normalize_barcode(item.get("barcodes"))
    brand_code = _extract_brand_code(item.get("groups"))
    brand_id = None
    brand_name = None
    if brand_code and is_active:
        brand = (
            db.query(Brand)
            .filter(Brand.code == brand_code, Brand.is_active.is_(True))
            .one_or_none()
        )
        if brand:
            brand_id = brand.id
            brand_name = brand.display_name or brand.name
        else:
            if brand_code not in unknown_codes and len(errors) < max_errors:
                unknown_codes.add(brand_code)
                errors.append(SyncError(external_id=external_id, reason=f"Unknown brand code: {brand_code}"))
    existing = (
        db.query(Product)
        .options(selectinload(Product.barcodes))
        .filter(Product.external_source == "smartup", Product.external_id == external_id)
        .one_or_none()
    )
    if existing:
        changed = False
        fields = {
            "smartup_code": code,
            "sku": code,
            "name": name,
            "short_name": _truncate(item.get("short_name"), 512),
            "barcode": barcode_primary,
            "article_code": item.get("article_code"),
            "is_active": is_active,
            "smartup_groups": item.get("groups", []),
            "raw_payload": item,
            "brand_id": brand_id if is_active else None,
            "brand_code": brand_code if is_active else None,
            "brand": _truncate(brand_name, 256) if is_active else None,
        }
        for key, value in fields.items():
            if getattr(existing, key) != value:
                setattr(existing, key, value)
                changed = True
        if barcode_list and is_active:
            existing_codes = {b.barcode for b in existing.barcodes}
            for code_value in barcode_list:
                if code_value not in existing_codes:
                    existing.barcodes.append(ProductBarcode(barcode=code_value))
                    changed = True
        if changed:
            if do_commit:
                db.commit()
            return 0, 1, 0
        return 0, 0, 1
    if not is_active:
        return 0, 0, 1
    try:
        record = Product(
            external_source="smartup",
            external_id=external_id,
            smartup_code=code,
            sku=code,
            name=name,
            short_name=_truncate(item.get("short_name"), 512),
            barcode=barcode_primary,
            article_code=item.get("article_code"),
            is_active=is_active,
            smartup_groups=item.get("groups", []),
            raw_payload=item,
            brand_id=brand_id,
            brand_code=brand_code,
            brand=_truncate(brand_name, 256),
        )
        if barcode_list:
            record.barcodes = [ProductBarcode(barcode=code_value) for code_value in barcode_list]
        db.add(record)
        if do_commit:
            db.commit()
        return 1, 0, 0
    except IntegrityError:
        if do_commit:
            db.rollback()
        err = SyncError(external_id=external_id, reason="Duplicate SKU or barcode")
        err.sku = code
        err.barcode = barcode_primary
        errors.append(err)
        return 0, 0, 1
    except Exception as exc:  # noqa: BLE001
        if do_commit:
            db.rollback()
        errors.append(SyncError(external_id=external_id, reason=str(exc)))
        return 0, 0, 1


def _sync_products(
    db: Session,
    items: Iterable[dict],
    max_errors: int = 50,
    batch_size: int = 100,
) -> Tuple[int, int, int, list[SyncError]]:
    inserted = 0
    updated = 0
    skipped = 0
    errors: list[SyncError] = []
    unknown_codes: set[str] = set()
    items_list = list(items)
    batch_size = max(1, min(batch_size, 200))

    for start in range(0, len(items_list), batch_size):
        chunk = items_list[start : start + batch_size]
        batch_ins, batch_upd, batch_skip = 0, 0, 0
        try:
            for item in chunk:
                if len(errors) >= max_errors:
                    break
                i, u, s = _process_one_product(
                    db, item, unknown_codes, errors, max_errors, do_commit=False
                )
                batch_ins += i
                batch_upd += u
                batch_skip += s
            db.commit()
            inserted += batch_ins
            updated += batch_upd
            skipped += batch_skip
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            for item in chunk:
                if len(errors) >= max_errors:
                    break
                i, u, s = _process_one_product(
                    db, item, unknown_codes, errors, max_errors, do_commit=True
                )
                inserted += i
                updated += u
                skipped += s
        if len(errors) >= max_errors:
            break

    return inserted, updated, skipped, errors


def sync_smartup_products(
    db: Session,
    code: str | None = None,
    begin_created_on: str | None = None,
    end_created_on: str | None = None,
    begin_modified_on: str | None = None,
    end_modified_on: str | None = None,
) -> tuple[SmartupSyncRun, int, int, int, list[SyncError]]:
    payload = {
        "code": code or "",
        "begin_created_on": begin_created_on or "",
        "end_created_on": end_created_on or "",
        "begin_modified_on": begin_modified_on or "",
        "end_modified_on": end_modified_on or "",
    }

    run = SmartupSyncRun(
        run_type="products",
        request_payload=payload,
        params_json=payload,
        status="running",
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        client = SmartupInventoryExportClient()
        response = client.export_inventory(payload)
        items = response.get("inventory") or []
        inserted, updated, skipped, errors = _sync_products(db, items)

        run.inserted_count = inserted
        run.updated_count = updated
        run.skipped_count = skipped
        run.error_count = len(errors)
        run.errors_json = [error.__dict__ for error in errors]
        run.success_count = inserted + updated
        run.status = "success"
        db.add(run)
        db.commit()
        db.refresh(run)
        return run, inserted, updated, skipped, errors
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = "failed"
        run.error_message = str(exc)
        run.error_count = 1
        run.errors_json = [{"external_id": "smartup", "reason": str(exc)}]
        db.add(run)
        db.commit()
        raise
