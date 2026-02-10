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


def _sync_products(
    db: Session,
    items: Iterable[dict],
    max_errors: int = 50,
) -> Tuple[int, int, int, list[SyncError]]:
    inserted = 0
    updated = 0
    skipped = 0
    errors: list[SyncError] = []
    unknown_codes: set[str] = set()

    for item in items:
        external_id = str(item.get("product_id") or "").strip()
        if not external_id:
            skipped += 1
            continue
        try:
            code = str(item.get("code") or "").strip()
            name = str(item.get("name") or "").strip()
            if not code or not name:
                skipped += 1
                continue
            barcode_primary, barcode_list = _normalize_barcode(item.get("barcodes"))
            brand_code = _extract_brand_code(item.get("groups"))
            brand_id = None
            brand_name = None
            if brand_code:
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
                        errors.append(
                            SyncError(external_id=external_id, reason=f"Unknown brand code: {brand_code}")
                        )

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
                    "short_name": item.get("short_name"),
                    "barcode": barcode_primary,
                    "article_code": item.get("article_code"),
                    "is_active": item.get("state") == "A",
                    "smartup_groups": item.get("groups", []),
                    "raw_payload": item,
                    "brand_id": brand_id,
                    "brand_code": brand_code,
                    "brand": brand_name,
                }
                for key, value in fields.items():
                    if getattr(existing, key) != value:
                        setattr(existing, key, value)
                        changed = True

                if barcode_list:
                    existing_codes = {b.barcode for b in existing.barcodes}
                    for code_value in barcode_list:
                        if code_value not in existing_codes:
                            existing.barcodes.append(ProductBarcode(barcode=code_value))
                            changed = True

                if changed:
                    db.commit()
                    updated += 1
                else:
                    skipped += 1
                continue

            record = Product(
                external_source="smartup",
                external_id=external_id,
                smartup_code=code,
                sku=code,
                name=name,
                short_name=item.get("short_name"),
                barcode=barcode_primary,
                article_code=item.get("article_code"),
                is_active=item.get("state") == "A",
                smartup_groups=item.get("groups", []),
                raw_payload=item,
                brand_id=brand_id,
                brand_code=brand_code,
                brand=brand_name,
            )
            if barcode_list:
                record.barcodes = [ProductBarcode(barcode=code_value) for code_value in barcode_list]
            db.add(record)
            db.commit()
            inserted += 1
        except IntegrityError:
            db.rollback()
            errors.append(SyncError(external_id=external_id, reason="Duplicate SKU or barcode"))
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            errors.append(SyncError(external_id=external_id, reason=str(exc)))

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
