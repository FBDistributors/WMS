# WMS — 4 Zona (NORMAL, EXPIRED, DAMAGED, QUARANTINE) Implementatsiya

**Rol:** Senior FastAPI + PostgreSQL + WMS Architect  
**Maqsad:** Production-ready zona turlari, FEFO/picking faqat NORMAL, move-to-zone, adjust, auto-expired job, inventory count workflow.

---

# 1) DATABASE DESIGN

## 1.1 Migration (Alembic)

**Fayl:** `backend/alembic/versions/20260222_0040_zone_types_and_reason_code.py`

```python
"""Add zone_type to locations, reason_code to stock_movements; movement_type CHECK (no allocate/unallocate).

Revision ID: 20260222_0040
Revises: 20260219_0039
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260222_0040"
down_revision = "20260219_0039"
branch_labels = None
depends_on = None

ZONE_TYPES = ("NORMAL", "EXPIRED", "DAMAGED", "QUARANTINE")
# On-hand only (Variant A): no allocate, unallocate
MOVEMENT_TYPES = (
    "opening_balance", "receipt", "putaway", "pick", "ship",
    "adjust", "transfer_in", "transfer_out",
)


def upgrade():
    # --- locations: zone_type ---
    op.add_column(
        "locations",
        sa.Column("zone_type", sa.String(32), nullable=True),
    )
    op.execute(
        "UPDATE locations SET zone_type = 'NORMAL' WHERE zone_type IS NULL"
    )
    op.alter_column(
        "locations",
        "zone_type",
        nullable=False,
        server_default="NORMAL",
    )
    op.create_check_constraint(
        "ck_locations_zone_type",
        "locations",
        f"zone_type IN {ZONE_TYPES}",
    )
    op.create_index("ix_locations_zone_type", "locations", ["zone_type"])

    # --- locations: warehouse_id (optional, for "per warehouse" constraint) ---
    op.add_column(
        "locations",
        sa.Column("warehouse_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_locations_warehouse_id",
        "locations",
        "locations",
        ["warehouse_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_locations_warehouse_id", "locations", ["warehouse_id"])

    # --- stock_movements: reason_code ---
    op.add_column(
        "stock_movements",
        sa.Column("reason_code", sa.String(64), nullable=True),
    )
    op.create_index("ix_stock_movements_reason_code", "stock_movements", ["reason_code"])

    # --- stock_movements: movement_type CHECK (allocate/unallocate yo'q) ---
    op.drop_constraint("ck_stock_movements_type", "stock_movements", type_="check")
    op.create_check_constraint(
        "ck_stock_movements_type",
        "stock_movements",
        f"movement_type IN {MOVEMENT_TYPES}",
    )

    # --- Indexlar (mavjud bo'lsa skip) ---
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_stock_movements_product_lot_location "
        "ON stock_movements (product_id, lot_id, location_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_stock_lots_product_expiry "
        "ON stock_lots (product_id, expiry_date)"
    )


def downgrade():
    op.drop_index("ix_stock_movements_reason_code", table_name="stock_movements")
    op.drop_column("stock_movements", "reason_code")
    op.drop_constraint("ck_stock_movements_type", "stock_movements", type_="check")
    op.create_check_constraint(
        "ck_stock_movements_type",
        "stock_movements",
        "movement_type IN ('opening_balance','receipt','putaway','allocate','unallocate','pick','ship','adjust','transfer_in','transfer_out')",
    )
    op.drop_index("ix_locations_warehouse_id", table_name="locations")
    op.drop_constraint("fk_locations_warehouse_id", "locations", type_="foreignkey")
    op.drop_column("locations", "warehouse_id")
    op.drop_index("ix_locations_zone_type", table_name="locations")
    op.drop_constraint("ck_locations_zone_type", "locations", type_="check")
    op.drop_column("locations", "zone_type")
```

## 1.2 Per-warehouse constraint strategiyasi

**Talab:** Har warehouse ichida kamida 1 ta NORMAL, 1 ta EXPIRED, 1 ta DAMAGED.

**Variant A (application-level):** Location yaratish/o‘zgartirishda (admin API): agar `warehouse_id` berilgan bo‘lsa, tekshirish: `SELECT COUNT(DISTINCT zone_type) FROM locations WHERE warehouse_id = :wid AND zone_type IN ('NORMAL','EXPIRED','DAMAGED')` — kamida 3 ta bo‘lishi kerak (yoki har biri uchun EXISTS). Agar bitta NORMAL ni EXPIRED qilib o‘zgartirsak, avvalo boshqa NORMAL mavjudligini tekshirish.

**Variant B (DB trigger):** `locations` uchun BEFORE INSERT OR UPDATE OR DELETE trigger: o‘zgargan/o‘chirilayotgan qatorning `warehouse_id` bo‘yicha qolgan location larda NORMAL, EXPIRED, DAMAGED ning har biri kamida 1 ta qolishini tekshirish. O‘chirishda: agar bu location oxirgi NORMAL bo‘lsa, raise exception.

**Tavsiya:** Birinchi bosqichda Variant A (service layer da tekshirish). Keyin kerak bo‘lsa trigger qo‘shish.

## 1.3 SQLAlchemy model yangilanishlari

**backend/app/models/location.py**

```python
# ... existing imports ...
ZONE_TYPES = ("NORMAL", "EXPIRED", "DAMAGED", "QUARANTINE")

class Location(Base):
    # ... existing columns ...
    zone_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="NORMAL", server_default="NORMAL"
    )
    warehouse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        # ... existing ...
        CheckConstraint(
            f"zone_type IN {ZONE_TYPES}",
            name="ck_locations_zone_type",
        ),
        Index("ix_locations_zone_type", "zone_type"),
        Index("ix_locations_warehouse_id", "warehouse_id"),
    )
```

**backend/app/models/stock.py**

```python
# Movement types: on-hand only (no allocate/unallocate)
ON_HAND_MOVEMENT_TYPES = (
    "opening_balance", "receipt", "putaway", "pick", "ship",
    "adjust", "transfer_in", "transfer_out",
)

class StockMovement(Base):
    # ... existing columns ...
    reason_code: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        # ... existing indexes ...
        Index("ix_stock_movements_reason_code", "reason_code"),
        CheckConstraint(
            f"movement_type IN {tuple(ON_HAND_MOVEMENT_TYPES)}",
            name="ck_stock_movements_type",
        ),
    )
```

---

# 2) BUSINESS LOGIC CHANGES

## 2.1 FEFO query (faqat NORMAL zone)

**Fayl:** `backend/app/api/v1/endpoints/orders.py` — `_fefo_available_lots`

```python
def _fefo_available_lots(db: Session, product_id: UUID):
    return (
        db.query(
            StockMovementModel.lot_id,
            StockMovementModel.location_id,
            func.sum(StockMovementModel.qty_change).label("qty"),
            StockLotModel.batch,
            StockLotModel.expiry_date,
            LocationModel.code.label("location_code"),
        )
        .join(StockLotModel, StockLotModel.id == StockMovementModel.lot_id)
        .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
        .filter(
            StockLotModel.product_id == product_id,
            LocationModel.zone_type == "NORMAL",  # --- ZONA: faqat NORMAL ---
            LocationModel.is_active.is_(True),
        )
        .group_by(
            StockMovementModel.lot_id,
            StockMovementModel.location_id,
            StockLotModel.batch,
            StockLotModel.expiry_date,
            LocationModel.code,
        )
        .having(func.sum(StockMovementModel.qty_change) > 0)
        .order_by(
            StockLotModel.expiry_date.asc().nullslast(),
            LocationModel.code.asc(),
        )
        .all()
    )
```

**Expired lotlarni ignore:** FEFO da `StockLotModel.expiry_date.asc().nullslast()` — muddati o‘tgan lotlar ham ro‘yxatda chiqadi. Allocation service da **expired lotlarni ignore** qilish kerak: `WHERE (lot.expiry_date IS NULL OR lot.expiry_date >= CURRENT_DATE)`.

```python
# _fefo_available_lots ichida filter qo'shish:
.filter(
    StockLotModel.product_id == product_id,
    LocationModel.zone_type == "NORMAL",
    LocationModel.is_active.is_(True),
    # Expired lotlarni allocation'dan chiqarish:
    (StockLotModel.expiry_date.is_(None) | (StockLotModel.expiry_date >= date.today())),
)
```

## 2.2 Picking: lot NORMAL zonada bo‘lishi shart

**Fayl:** `backend/app/api/v1/endpoints/picking.py` — `_pick_line_impl` ichida, movement yozishdan oldin:

```python
# Line uchun location zone tekshiruvi
loc = db.query(LocationModel).filter(
    LocationModel.id == line.location_id
).one_or_none()
if not loc or loc.zone_type != "NORMAL":
    raise HTTPException(
        status_code=400,
        detail="Pick only from NORMAL zone. Line location is not NORMAL.",
    )
```

## 2.3 Receiving: default NORMAL; expiry < today bo‘lsa EXPIRED zone

**Receiving create (draft):** Client `location_id` yuboradi. Agar yubormasa, default: warehouse dagi birinchi NORMAL location.

**Complete receipt:** Har bir line uchun:
- `expiry_date < today` bo‘lsa: **target_location_id** = warehouse dagi EXPIRED zone location (bitta); lot/location bo‘yicha movement **receipt** — location_id = EXPIRED zone.
- Aks holda: line.location_id (NORMAL bo‘lishi kerak) — receipt movement shu location ga.

```python
# complete_receipt ichida (pseudo-code):
for line in receipt.lines:
    if line.expiry_date and line.expiry_date < date.today():
        target_loc = get_location_by_zone_type(db, warehouse_id, "EXPIRED")
        if not target_loc:
            raise HTTPException(400, "EXPIRED zone location not found for warehouse")
        location_id = target_loc.id
    else:
        location_id = line.location_id  # client yuborgan yoki default NORMAL
    # ... lot get-or-create ...
    movement = StockMovementModel(..., location_id=location_id, movement_type="receipt", ...)
```

---

# 3) NEW OPERATIONS

## 3.1 Move to Zone — service pseudo-code

```python
def move_to_zone(
    db: Session,
    product_id: UUID,
    lot_id: UUID,
    from_location_id: UUID,
    qty: Decimal,
    target_zone_type: str,  # EXPIRED | DAMAGED | QUARANTINE
    reason_code: str,
    comment: str | None,
    user_id: UUID,
) -> None:
    if qty <= 0:
        raise ValueError("qty must be positive")
    if target_zone_type not in ("EXPIRED", "DAMAGED", "QUARANTINE"):
        raise ValueError("Invalid target_zone_type")
    from_loc = db.query(Location).filter(Location.id == from_location_id).one_or_none()
    if not from_loc or from_loc.zone_type != "NORMAL":
        raise ValueError("from_location must be NORMAL zone")
    on_hand_from = get_on_hand(db, product_id, lot_id, from_location_id)
    if on_hand_from < qty:
        raise ValueError("Insufficient qty at from_location")
    to_loc = get_location_by_zone_type(db, from_loc.warehouse_id or from_loc.id, target_zone_type)
    if not to_loc:
        raise ValueError(f"No {target_zone_type} location for warehouse")
    # Atomic: 2 movements
    db.add(StockMovement(
        product_id=product_id, lot_id=lot_id, location_id=from_location_id,
        qty_change=-qty, movement_type="transfer_out",
        reason_code=reason_code, created_by_user_id=user_id,
        source_document_type="move_to_zone", source_document_id=None,
    ))
    db.add(StockMovement(
        product_id=product_id, lot_id=lot_id, location_id=to_loc.id,
        qty_change=+qty, movement_type="transfer_in",
        reason_code=reason_code, created_by_user_id=user_id,
        source_document_type="move_to_zone", source_document_id=None,
    ))
    log_action(db, user_id, "move_to_zone", "stock_movement", ..., new_data={"comment": comment})
    db.commit()
```

## 3.2 Move to Zone — endpoint skelet

**POST /api/v1/inventory/move-to-zone**

```python
class MoveToZoneRequest(BaseModel):
    product_id: UUID
    lot_id: UUID
    from_location_id: UUID
    qty: Decimal  # > 0
    target_zone_type: Literal["EXPIRED", "DAMAGED", "QUARANTINE"]
    reason_code: Optional[str] = None
    comment: Optional[str] = None

@router.post("/move-to-zone", status_code=status.HTTP_200_OK)
async def move_to_zone(
    payload: MoveToZoneRequest,
    db: Session = Depends(get_db),
    user = Depends(require_permission("inventory:adjust")),
):
    if payload.qty <= 0:
        raise HTTPException(400, "qty must be positive")
    try:
        move_to_zone_service(db, payload, user.id)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    return {"status": "ok"}
```

## 3.3 Adjust — service + endpoint

**Logic:** reservation tekshiruvi (available = on_hand - reserved; adjust dan keyin available >= 0 bo‘lishi kerak). Movement: `adjust`, qty_change = +delta (overage) yoki -delta (shortage).

```python
def adjust(
    db: Session,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
    delta_qty: Decimal,  # positive = overage, negative = shortage
    reason_code: str,  # inventory_shortage | inventory_overage
    user_id: UUID,
) -> None:
    on_hand = get_on_hand(db, product_id, lot_id, location_id)
    reserved = get_reserved(db, lot_id, location_id)  # stock_reservations
    available_after = on_hand + delta_qty - reserved
    if available_after < 0:
        raise ValueError("Adjust would make available negative; check reservation.")
    if reason_code not in ("inventory_shortage", "inventory_overage"):
        raise ValueError("reason_code must be inventory_shortage or inventory_overage")
    db.add(StockMovement(
        product_id=product_id, lot_id=lot_id, location_id=location_id,
        qty_change=delta_qty, movement_type="adjust",
        reason_code=reason_code, created_by_user_id=user_id,
    ))
    log_action(db, user_id, "adjust", "stock_movement", ...)
    db.commit()
```

**POST /api/v1/inventory/adjust** — body: product_id, lot_id, location_id, delta_qty, reason_code (inventory_shortage | inventory_overage).

---

# 4) ADMIN UI CHANGES (spetsifikatsiya)

- **Inventory sahifa:** Zone filter dropdown (NORMAL, EXPIRED, DAMAGED, QUARANTINE). Har qator uchun: "Move to Expired", "Move to Damaged", "Adjust" tugmalari (faqat NORMAL dan move; adjust har qanday zonada).
- **Product detail:** Zonalar bo‘yicha qoldiq: NORMAL / EXPIRED / DAMAGED / QUARANTINE ustunlari yoki jadval (location_code, zone_type, qty).

---

# 5) AUTO EXPIRED JOB (cron/worker pseudo-code)

```python
def auto_expired_job(db: Session) -> int:
    today = date.today()
    # (product_id, lot_id, location_id) where expiry_date < today, zone NORMAL, on_hand > 0
    rows = db.execute(sa.text("""
        SELECT sm.product_id, sm.lot_id, sm.location_id, l.warehouse_id,
               SUM(sm.qty_change) AS on_hand
        FROM stock_movements sm
        JOIN locations l ON l.id = sm.location_id
        JOIN stock_lots sl ON sl.id = sm.lot_id
        WHERE l.zone_type = 'NORMAL'
          AND sl.expiry_date < :today
        GROUP BY sm.product_id, sm.lot_id, sm.location_id, l.warehouse_id
        HAVING SUM(sm.qty_change) > 0
    """), {"today": today}).fetchall()
    count = 0
    for row in rows:
        warehouse_id = row.warehouse_id or row.location_id  # fallback
        exp_loc = get_location_by_zone_type(db, warehouse_id, "EXPIRED")
        if not exp_loc:
            continue
        move_to_zone(db, row.product_id, row.lot_id, row.location_id,
                     Decimal(row.on_hand), "EXPIRED", "auto_expired", "Daily auto-expired", system_user_id)
        count += 1
    return count
```

---

# 6) INVENTORY COUNT WORKFLOW

1. Operator real qty kiritadi (product_id, lot_id, location_id, real_qty).
2. System qty = get_on_hand(product_id, lot_id, location_id).
3. Farq = real_qty - system_qty.
   - **negative** → adjust -|farq|, reason_code = inventory_shortage.
   - **positive** → adjust +farq, reason_code = inventory_overage.
4. Agar operator "expired" deb belgilasa → move-to-zone EXPIRED (NORMAL dan).
5. Agar operator "damaged" deb belgilasa → move-to-zone DAMAGED (NORMAL dan).

---

# 7) TEST CHECKLIST

- [ ] Expired mahsulot (EXPIRED zone da) pick qilinmasin: line.location zone_type != NORMAL → 400.
- [ ] Damaged zone dan pick 400.
- [ ] Move-to-zone atomic: transfer_out + transfer_in bitta transaction; rollback ikkalasini ham bekor qiladi.
- [ ] Adjust: reserved_qty dan ortiqcha adjust (available manfiy bo‘ladi) 400/409.
- [ ] Concurrent pick + move: pick NORMAL dan, parallel move NORMAL → EXPIRED; bitta pick, bitta move — deadlock bo‘lmasin, yoki move keyinroq bo‘lsa pick 400 (yetarli emas).

---

# 8) YORDAMCHI: get_location_by_zone_type

```python
def get_location_by_zone_type(
    db: Session,
    warehouse_id: UUID,
    zone_type: str,
) -> Location | None:
    return (
        db.query(Location)
        .filter(
            Location.warehouse_id == warehouse_id,
            Location.zone_type == zone_type,
            Location.is_active.is_(True),
        )
        .first()
    )
```
Agar `warehouse_id` bo‘lmasa, parent_id yoki boshqa guruhlash bo‘yicha qidirish kerak (loyiha qoidasiga qarab).

---

# 9) RISKLAR VA EHTIYOT CHORALARI

| Risk | Chora |
|------|--------|
| Mavjud movement_type CHECK da allocate/unallocate bor | Migration da CHECK ni almashtirish — yangi movement lar faqat on_hand. **Eski allocate/unallocate qatorlar mavjud bo‘lsa migration FAIL bo‘ladi.** Avval: (1) stock_reservations jadvali va reserved migratsiya qilingan bo‘lishi kerak, (2) yoki eski movement larni o‘chirish/arxivlash, (3) yoki bu migration ni faqat yangi muhitda qo‘llang. |
| Receiving complete da EXPIRED zone topilmasa | Warehouse da kamida 1 ta EXPIRED location bo‘lishini per-warehouse constraint/seed bilan ta’minlash. |
| FEFO va picking faqat NORMAL | Barcha FEFO va pick endpoint larida location.zone_type == 'NORMAL' tekshiruvi. |
| Auto-expired job bir xil (lot, location) ni bir necha marta ko‘chirishi | Job da har (product_id, lot_id, location_id) uchun bitta move_to_zone; keyingi kun yana tekshiradi (qolgan NORMAL bo‘lsa). |
| Inventarizatsiya farqi boshqa zonaga move orqali emas | Faqat adjust movement; move-to-zone alohida (expired/damaged belgilash). |
