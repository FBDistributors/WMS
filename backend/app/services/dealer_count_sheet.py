"""Diller sanovi — ro'yxat (ведомость): to'ldirish, qator tahriri, telefondan sanalganlar.

Holat va qulf yo'q: sanov web'da yaratiladi va to'ldiriladi (miqdor bo'sh, Smartup soni
snapshot), bir yoki bir necha xodim telefonda uni sanaydi. Har qator — mahsulot + muddat +
joy (javon/zona); `qty IS NULL` — sanalmagan, 0 — "dillerda yo'q" deb sanaldi.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
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
from app.services.product_scan_resolve import resolve_product_scan

PREFILL_SOURCES = ("smartup", "shipped", "all")
LOCATION_MAX = 32
#: Telefon soati oldinda bo'lsa ham kelajakdagi vaqt yozilmasin (keyingi sanashlar "eski" bo'lib qolmasin).
CLOCK_SKEW = timedelta(minutes=5)


def month_start(d: Optional[date]) -> Optional[date]:
    return d.replace(day=1) if d else None


def norm_location(v: Optional[str]) -> Optional[str]:
    """Joy kodi: bo'shliqlar olinadi, katta harf (skaner va qo'lda yozilgani bir xil bo'lsin)."""
    s = " ".join((v or "").split()).upper()[:LOCATION_MAX]
    return s or None


def line_key(product_id, expiry: Optional[date], location: Optional[str]) -> tuple:
    return (product_id, expiry, location)


def recount(item: DealerStockCount) -> None:
    """Faqat sanalgan (qty bor) qatorlar hisobga olinadi; ro'yxatning sanalmaganlari emas."""
    counted = [ln for ln in item.lines if ln.qty is not None]
    item.lines_count = len(counted)
    item.total_units = sum((Decimal(str(ln.qty)) for ln in counted), Decimal("0"))


def _next_seq(item: DealerStockCount) -> int:
    return max((ln.seq for ln in item.lines), default=0) + 1


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
    """Ro'yxatga mahsulotlar qo'shish. Ro'yxatda allaqachon bor mahsulotga tegilmaydi.

    Qaytaradi: qo'shilgan / o'tkazib yuborilgan / katalogda yo'q SKU soni, manbalar.
    """
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
    seq = _next_seq(item) - 1
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
    if item.source in ("mobile", "web"):
        item.source = "sheet"
    return {"added": added, "skipped": skipped, "not_in_catalog": not_in_catalog, "sources": used}


def _resolve_product(db: Session, product_id: Optional[UUID], barcode: str) -> Optional[UUID]:
    if product_id is None and barcode:
        resolved = resolve_product_scan(db, barcode)
        return resolved.product_id if resolved else None
    if product_id is not None and not db.get(ProductModel, product_id):
        raise HTTPException(status_code=400, detail=f"Mahsulot topilmadi: {product_id}")
    return product_id


def add_lines(db: Session, item: DealerStockCount, user: User, lines: list[dict]) -> dict:
    """Web'dan qator qo'shish (jadval, Excel). Mavjud mahsulot+muddat+joyga: miqdor berilgan
    bo'lsa — almashtiriladi (sanalgan bo'ladi), berilmagan bo'lsa — tegilmaydi.

    lines: [{product_id?, scanned_barcode, qty?, snapshot_qty?, expiry_date?, location_code?}]
    """
    now = datetime.now(timezone.utc)
    by_key = {line_key(ln.product_id, ln.expiry_date, ln.location_code): ln for ln in item.lines if ln.product_id}
    added = updated = 0
    for raw in lines:
        barcode = (raw.get("scanned_barcode") or "").strip()[:64]
        pid = _resolve_product(db, raw.get("product_id"), barcode)
        expiry = month_start(raw.get("expiry_date"))
        loc = norm_location(raw.get("location_code"))
        qty = raw.get("qty")
        qty = Decimal(str(qty)) if qty is not None else None
        line = by_key.get(line_key(pid, expiry, loc)) if pid else None
        if line is not None:
            if qty is not None:
                line.qty = qty
                line.counted_at = now
                line.counted_by_user_id = user.id
                updated += 1
            continue
        snap = raw.get("snapshot_qty")
        line = DealerStockCountLine(
            product_id=pid,
            scanned_barcode=barcode,
            qty=qty,
            snapshot_qty=Decimal(str(snap)) if snap is not None else None,
            expiry_date=expiry,
            location_code=loc,
            counted_at=now if qty is not None else None,
            counted_by_user_id=user.id if qty is not None else None,
            seq=_next_seq(item),
        )
        item.lines.append(line)
        if pid:
            by_key[line_key(pid, expiry, loc)] = line
        added += 1
    return {"added": added, "updated": updated}


def patch_line(item: DealerStockCount, line: DealerStockCountLine, user: User, fields: dict) -> None:
    """Web'dan bitta qatorni o'zgartirish. `qty: None` — "sanalmagan"ga qaytarish."""
    new_expiry = month_start(fields["expiry_date"]) if "expiry_date" in fields else line.expiry_date
    new_loc = norm_location(fields["location_code"]) if "location_code" in fields else line.location_code
    if line.product_id and (new_expiry, new_loc) != (line.expiry_date, line.location_code):
        clash = next(
            (
                o
                for o in item.lines
                if o is not line and line_key(o.product_id, o.expiry_date, o.location_code)
                == line_key(line.product_id, new_expiry, new_loc)
            ),
            None,
        )
        if clash is not None:
            raise HTTPException(status_code=409, detail="Bu mahsulot shu muddat va joy bilan ro'yxatda bor")
    line.expiry_date = new_expiry
    line.location_code = new_loc
    if "qty" in fields:
        qty = fields["qty"]
        if qty is None:
            line.qty = None
            line.counted_at = None
            line.counted_by_user_id = None
        else:
            line.qty = Decimal(str(qty))
            line.counted_at = datetime.now(timezone.utc)
            line.counted_by_user_id = user.id


def apply_counts(db: Session, item: DealerStockCount, user: User, entries: list[dict]) -> dict:
    """Telefondan sanalgan qatorlar (idempotent, bir necha xodim bir vaqtda).

    entries: [{line_id?, product_id?, scanned_barcode?, qty, expiry_date?, location_code?, counted_at?}].
    Qator: `line_id` bo'yicha, bo'lmasa mahsulot+muddat+joy, bo'lmasa ro'yxatdagi shu mahsulotning
    hali sanalmagan joysiz qatori; topilmasa — yangi qator (javonda bor, ro'yxatda yo'q tovar).
    Kelgan `counted_at` serverdagidan eski bo'lsa yozilmaydi — kech ulangan telefon boshqaning
    yangi sanaganini bosib ketmasin.
    """
    now = datetime.now(timezone.utc)
    by_id = {ln.id: ln for ln in item.lines}
    by_key = {line_key(ln.product_id, ln.expiry_date, ln.location_code): ln for ln in item.lines if ln.product_id}
    updated = added = stale = 0
    for e in entries:
        qty = Decimal(str(e.get("qty") if e.get("qty") is not None else 0))
        if qty < 0:
            raise HTTPException(status_code=400, detail="Miqdor manfiy bo'lmasligi kerak")
        expiry = month_start(e.get("expiry_date"))
        loc = norm_location(e.get("location_code"))
        at = e.get("counted_at") or now
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        if at > now + CLOCK_SKEW:
            at = now
        pid = e.get("product_id")
        line: Optional[DealerStockCountLine] = by_id.get(e["line_id"]) if e.get("line_id") else None
        if line is None and pid:
            line = by_key.get(line_key(pid, expiry, loc))
            if line is None:
                line = next(
                    (
                        ln
                        for ln in item.lines
                        if ln.product_id == pid and ln.counted_at is None and ln.location_code is None
                    ),
                    None,
                )
        if line is not None and line.product_id:
            # Qator yangi muddat/joyga ko'chsa va u kalit boshqa qatorda bo'lsa — o'sha qatorga yoziladi.
            other = by_key.get(line_key(line.product_id, expiry, loc))
            if other is not None and other is not line:
                line = other
        if line is None:
            if pid and not db.get(ProductModel, pid):
                raise HTTPException(status_code=400, detail=f"Mahsulot topilmadi: {pid}")
            line = DealerStockCountLine(
                product_id=pid,
                scanned_barcode=(e.get("scanned_barcode") or "")[:64],
                seq=_next_seq(item),
            )
            item.lines.append(line)
            added += 1
        else:
            prev = line.counted_at
            if prev is not None and prev.tzinfo is None:
                prev = prev.replace(tzinfo=timezone.utc)
            if prev is not None and at < prev:
                stale += 1
                continue
            updated += 1
        if line.product_id:
            by_key.pop(line_key(line.product_id, line.expiry_date, line.location_code), None)
        line.qty = qty
        line.expiry_date = expiry
        line.location_code = loc
        line.counted_at = at
        line.counted_by_user_id = user.id
        if e.get("scanned_at"):
            line.scanned_at = e["scanned_at"]
        if line.product_id:
            by_key[line_key(line.product_id, expiry, loc)] = line
    return {"updated": updated, "added": added, "stale": stale}
