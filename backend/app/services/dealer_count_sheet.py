"""Diller sanovi — tayyor ro'yxat (ведомость): to'ldirish, olish (claim), sanalganlarni yozish.

Ro'yxat sanovdan oldin web'da to'ldiriladi (miqdor bo'sh, Smartup soni snapshot),
telefon uni oladi (`in_progress` — web qulf), skan bilan sanaydi va faqat sanalgan
qatorlarni yuboradi. Sanalmagan qator `qty IS NULL` — "dillerda yo'q" (0) dan farqli.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.dealer_stock_count import DealerStockCount, DealerStockCountLine
from app.models.order import Order as OrderModel, OrderLine as OrderLineModel
from app.models.product import Product as ProductModel
from app.models.user import User
from app.services.dealer_count_compare import dealer_warehouse_code, load_dealer_balance

PREFILL_SOURCES = ("smartup", "shipped", "all")
LOCK_DETAIL = "Ro'yxat telefonda sanalmoqda — web'dan o'zgartirib bo'lmaydi"


def shipped_skus(db: Session, dealer_org_id: str, *, months: int) -> set[str]:
    """Dillerga jo'natilgan tovarlar (diller harakatlari qatorlari), oxirgi N oy."""
    since = datetime.now(timezone.utc) - timedelta(days=30 * max(1, months))
    rows = (
        db.query(OrderLineModel.sku)
        .join(OrderModel, OrderModel.id == OrderLineModel.order_id)
        .filter(
            OrderModel.source == "diller",
            OrderModel.to_filial_code == dealer_org_id,
            OrderModel.created_at >= since,
            OrderLineModel.sku.isnot(None),
        )
        .distinct()
        .all()
    )
    return {str(r[0]).strip() for r in rows if r[0]}


def prefill_sheet(
    db: Session,
    item: DealerStockCount,
    *,
    sources: list[str],
    months: int = 6,
    refresh: bool = False,
) -> dict:
    """Ro'yxatga mahsulotlar qo'shish. Mavjud qatorlarga (product_id) tegilmaydi.

    Qaytaradi: qo'shilgan / o'tkazib yuborilgan / katalogda yo'q SKU soni, manbalar.
    """
    if item.status != "draft":
        raise HTTPException(status_code=409, detail="Faqat draft ro'yxatni to'ldirish mumkin")
    wanted = [s for s in sources if s in PREFILL_SOURCES]
    if not wanted:
        raise HTTPException(status_code=400, detail="Manba tanlanmagan (smartup / shipped / all)")

    skus: dict[str, Optional[float]] = {}  # sku -> snapshot (Smartup) yoki None
    smartup: dict[str, float] = {}
    used: list[str] = []
    if "smartup" in wanted:
        if dealer_warehouse_code(db, item.dealer_org_id):
            smartup, _src, _wh = load_dealer_balance(db, item.dealer_org_id, refresh=refresh)
            for sku, q in smartup.items():
                skus.setdefault(sku, q)
            used.append("smartup")
        elif "shipped" not in wanted:
            # Ombor kodi yo'q — jimgina jo'natilganlarga tushamiz (rejadagi standart zanjir).
            wanted.append("shipped")
    if "shipped" in wanted:
        for sku in shipped_skus(db, item.dealer_org_id, months=months):
            skus.setdefault(sku, None)
        used.append("shipped")
    if "all" in wanted:
        for (sku,) in db.query(ProductModel.sku).filter(ProductModel.is_active.is_(True)).all():
            if sku:
                skus.setdefault(sku, None)
        used.append("all")

    products = (
        {p.sku: p for p in db.query(ProductModel).filter(ProductModel.sku.in_(list(skus))).all()}
        if skus
        else {}
    )
    existing = {ln.product_id for ln in item.lines if ln.product_id}
    seq = max((ln.seq for ln in item.lines), default=0)
    added = skipped = not_in_catalog = 0
    for sku in sorted(skus):
        p = products.get(sku)
        if not p:
            not_in_catalog += 1
            continue
        if p.id in existing:
            skipped += 1
            continue
        seq += 1
        snap = skus[sku]
        if snap is None and sku in smartup:
            snap = smartup[sku]
        item.lines.append(
            DealerStockCountLine(
                product_id=p.id,
                scanned_barcode=p.barcode or "",
                qty=None,
                snapshot_qty=Decimal(str(snap)) if snap is not None else None,
                seq=seq,
            )
        )
        existing.add(p.id)
        added += 1
    if item.source == "mobile" or item.source == "web":
        item.source = "sheet"
    return {"added": added, "skipped": skipped, "not_in_catalog": not_in_catalog, "sources": used}


def claim_sheet(item: DealerStockCount, user: User) -> None:
    """Telefon ro'yxatni oladi: draft → in_progress. Boshqa xodim olgan bo'lsa 409."""
    if item.status == "submitted":
        raise HTTPException(status_code=409, detail="Sanov allaqachon yuborilgan")
    if item.status == "in_progress" and item.assigned_to_user_id not in (None, user.id):
        raise HTTPException(status_code=409, detail="Ro'yxatni boshqa xodim olgan")
    item.status = "in_progress"
    item.assigned_to_user_id = user.id
    item.claimed_at = item.claimed_at or datetime.now(timezone.utc)


def release_sheet(item: DealerStockCount) -> None:
    """Qulfni ochish (admin yoki olgan xodim): in_progress → draft."""
    if item.status != "in_progress":
        raise HTTPException(status_code=409, detail="Ro'yxat qulfda emas")
    item.status = "draft"
    item.assigned_to_user_id = None
    item.claimed_at = None


def apply_counts(
    db: Session,
    item: DealerStockCount,
    user: User,
    entries: list[dict],
) -> dict:
    """Telefondan sanalgan qatorlar (idempotent): line_id yoki product_id+expiry bo'yicha.

    entries: [{line_id?, product_id?, scanned_barcode?, qty, expiry_date?}]. Mos qator
    topilmasa — ro'yxatga yangi qator qo'shiladi (javonda bor, ro'yxatda yo'q tovar).
    """
    if item.status == "submitted":
        raise HTTPException(status_code=409, detail="Sanov allaqachon yuborilgan")
    now = datetime.now(timezone.utc)
    by_id = {ln.id: ln for ln in item.lines}
    by_key = {(ln.product_id, ln.expiry_date): ln for ln in item.lines if ln.product_id}
    seq = max((ln.seq for ln in item.lines), default=0)
    updated = added = 0
    for e in entries:
        qty = Decimal(str(e.get("qty") if e.get("qty") is not None else 0))
        if qty < 0:
            raise HTTPException(status_code=400, detail="Miqdor manfiy bo'lmasligi kerak")
        expiry = e.get("expiry_date")
        expiry = expiry.replace(day=1) if expiry else None
        line: Optional[DealerStockCountLine] = None
        lid = e.get("line_id")
        if lid and lid in by_id:
            line = by_id[lid]
        elif e.get("product_id"):
            line = by_key.get((e["product_id"], expiry))
            if line is None and expiry is None:
                # Muddatsiz sanov — ro'yxatdagi shu mahsulotning birinchi qatori.
                line = next((ln for ln in item.lines if ln.product_id == e["product_id"]), None)
        if line is None:
            pid = e.get("product_id")
            if pid and not db.get(ProductModel, pid):
                raise HTTPException(status_code=400, detail=f"Mahsulot topilmadi: {pid}")
            seq += 1
            line = DealerStockCountLine(
                product_id=pid,
                scanned_barcode=(e.get("scanned_barcode") or "")[:64],
                expiry_date=expiry,
                seq=seq,
            )
            item.lines.append(line)
            if pid:
                by_key[(pid, expiry)] = line
            added += 1
        else:
            updated += 1
        line.qty = qty
        line.counted_at = now
        line.counted_by_user_id = user.id
        if e.get("scanned_at"):
            line.scanned_at = e["scanned_at"]
    return {"updated": updated, "added": added}


def finalize_uncounted(item: DealerStockCount, policy: str) -> int:
    """Yuborishda sanalmagan qatorlar: zero — 0 yoziladi (counted_at bo'sh qoladi), keep — NULL."""
    if policy not in ("zero", "keep"):
        raise HTTPException(status_code=400, detail="uncounted: zero yoki keep")
    n = 0
    for ln in item.lines:
        if ln.qty is None:
            n += 1
            if policy == "zero":
                ln.qty = Decimal("0")
    item.uncounted_policy = policy
    return n
