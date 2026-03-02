# WMS SYSTEM AUDIT REPORT
## Real-Warehouse Reliability Analysis & Action Plan

**Date:** February 11, 2026  
**System:** WMS (FastAPI + PostgreSQL + React PWA)  
**Scope:** Receiving, Picking, Transfer, Adjustment, Offline Sync, FEFO, Idempotency

---

## EXECUTIVE SUMMARY

The WMS system has a **solid foundation** with event-sourced inventory tracking via `StockMovement` ledger. However, there are **7 CRITICAL RISKS** that could cause data corruption, double-picking, and sync conflicts in production warehouse operations.

**Overall Risk Level:** 🟡 MEDIUM-HIGH  
**Production Readiness:** 65% (needs critical fixes before multi-user deployment)

---

## 1. SINGLE SOURCE OF TRUTH FOR STOCK

### Current State Analysis ✅ GOOD FOUNDATION

**Finding:** The system correctly uses `StockMovement` as the append-only ledger (single source of truth).

```python
# stock.py - StockMovement is the ledger
class StockMovement(Base):
    qty_change: Mapped[Decimal]  # Can be positive or negative
    movement_type: Mapped[str]   # receipt, allocate, pick, ship, adjust, etc.
```

**Inventory calculation logic:**
- `on_hand = SUM(qty_change) WHERE movement_type NOT IN ('allocate', 'unallocate')`
- `reserved = SUM(qty_change) WHERE movement_type IN ('allocate', 'unallocate')`
- `available = on_hand - reserved`

### ⚠️ CRITICAL ISSUES FOUND

#### Issue 1.1: Missing CHECK Constraints on qty_change
**Risk:** Negative on-hand inventory possible  
**Impact:** Stock can go below zero, causing phantom inventory

**Current migration (20260209_0012):**
```python
sa.CheckConstraint("qty_change <> 0", name="ck_stock_movements_qty_nonzero"),
```

**Problem:** No constraint prevents `SUM(qty_change) < 0` per lot/location.

#### Issue 1.2: No Composite Index for Balance Queries
**Risk:** Slow inventory queries under load  
**Impact:** Timeout on `/inventory/summary` with 10K+ movements

**Missing index:**
```sql
CREATE INDEX ix_stock_movements_balance_calc 
ON stock_movements(product_id, lot_id, location_id, movement_type);
```

#### Issue 1.3: View Excludes 'pick' But Includes 'unallocate'
**Risk:** Double-counting reserved stock  
**Impact:** Available qty calculation is incorrect

**Current view (20260209_0015):**
```sql
CREATE VIEW stock_balances AS
SELECT lot_id, location_id, SUM(qty_change) AS qty
FROM stock_movements
WHERE movement_type <> 'pick'  -- ❌ Still includes 'unallocate'
GROUP BY lot_id, location_id
```

**Problem:** When picking happens:
1. `allocate` (+10 reserved)
2. `pick` (-10 on_hand) ← excluded from view
3. `unallocate` (-10 reserved) ← STILL COUNTED in view

Result: Reserved goes negative, available is overstated.

---

### ✅ RECOMMENDED APPROACH

#### 1.1 Add Application-Level Balance Validation

**File:** `backend/app/services/inventory_validator.py` (NEW)

```python
from decimal import Decimal
from uuid import UUID
from sqlalchemy import func, case
from sqlalchemy.orm import Session
from app.models.stock import StockMovement as StockMovementModel

class InsufficientStockError(Exception):
    def __init__(self, product_id: UUID, lot_id: UUID, location_id: UUID, 
                 available: Decimal, required: Decimal):
        self.product_id = product_id
        self.lot_id = lot_id
        self.location_id = location_id
        self.available = available
        self.required = required
        super().__init__(
            f"Insufficient stock: available={available}, required={required}"
        )

def get_available_qty(
    db: Session, 
    product_id: UUID, 
    lot_id: UUID, 
    location_id: UUID
) -> Decimal:
    """Calculate available qty for a specific lot/location."""
    on_hand_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(("allocate", "unallocate")), 0),
            else_=StockMovementModel.qty_change,
        )
    )
    reserved_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(("allocate", "unallocate")), 
             StockMovementModel.qty_change),
            else_=0,
        )
    )
    
    result = (
        db.query(
            (on_hand_expr - reserved_expr).label("available")
        )
        .filter(
            StockMovementModel.product_id == product_id,
            StockMovementModel.lot_id == lot_id,
            StockMovementModel.location_id == location_id,
        )
        .scalar()
    )
    
    return Decimal(str(result or 0))

def validate_sufficient_stock(
    db: Session,
    product_id: UUID,
    lot_id: UUID,
    location_id: UUID,
    required_qty: Decimal,
) -> None:
    """Raise InsufficientStockError if stock is insufficient."""
    available = get_available_qty(db, product_id, lot_id, location_id)
    if available < required_qty:
        raise InsufficientStockError(
            product_id, lot_id, location_id, available, required_qty
        )
```

#### 1.2 Add Composite Index Migration

**File:** `backend/alembic/versions/20260211_0022_add_balance_index.py` (NEW)

```python
"""Add composite index for balance calculations.

Revision ID: 20260211_0022
Revises: 20260210_0021
"""
from alembic import op

revision = "20260211_0022"
down_revision = "20260210_0021"

def upgrade():
    # Composite index for fast balance queries
    op.create_index(
        "ix_stock_movements_balance_calc",
        "stock_movements",
        ["product_id", "lot_id", "location_id", "movement_type"],
    )
    
    # Partial index for available stock queries (excludes allocate/unallocate)
    op.execute("""
        CREATE INDEX ix_stock_movements_on_hand 
        ON stock_movements(product_id, lot_id, location_id, qty_change)
        WHERE movement_type NOT IN ('allocate', 'unallocate')
    """)

def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_stock_movements_on_hand")
    op.drop_index("ix_stock_movements_balance_calc", table_name="stock_movements")
```

#### 1.3 Fix Stock Balances View

**File:** `backend/alembic/versions/20260211_0023_fix_balances_view.py` (NEW)

```python
"""Fix stock_balances view to correctly handle allocations.

Revision ID: 20260211_0023
Revises: 20260211_0022
"""
from alembic import op

revision = "20260211_0023"
down_revision = "20260211_0022"

def upgrade():
    op.execute("DROP VIEW IF EXISTS stock_balances")
    op.execute("""
        CREATE VIEW stock_balances AS
        SELECT
            product_id,
            lot_id,
            location_id,
            SUM(CASE 
                WHEN movement_type IN ('allocate', 'unallocate') THEN 0
                ELSE qty_change 
            END) AS on_hand,
            SUM(CASE 
                WHEN movement_type IN ('allocate', 'unallocate') THEN qty_change
                ELSE 0 
            END) AS reserved,
            SUM(CASE 
                WHEN movement_type IN ('allocate', 'unallocate') THEN 0
                ELSE qty_change 
            END) - SUM(CASE 
                WHEN movement_type IN ('allocate', 'unallocate') THEN qty_change
                ELSE 0 
            END) AS available
        FROM stock_movements
        GROUP BY product_id, lot_id, location_id
        HAVING SUM(CASE 
            WHEN movement_type IN ('allocate', 'unallocate') THEN 0
            ELSE qty_change 
        END) - SUM(CASE 
            WHEN movement_type IN ('allocate', 'unallocate') THEN qty_change
            ELSE 0 
        END) <> 0
    """)

def downgrade():
    op.execute("DROP VIEW IF EXISTS stock_balances")
    op.execute("""
        CREATE VIEW stock_balances AS
        SELECT lot_id, location_id, SUM(qty_change) AS qty
        FROM stock_movements
        WHERE movement_type <> 'pick'
        GROUP BY lot_id, location_id
    """)
```

---

## 2. FEFO RESERVATION & ALLOCATION (PREVENT DOUBLE-PICKING)

### Current State Analysis ⚠️ CRITICAL GAPS

**Finding:** FEFO allocation exists but has **race conditions** and **no reservation locking**.

#### Issue 2.1: Race Condition in _allocate_order()
**Risk:** Two orders can allocate the same lot simultaneously  
**Impact:** Overselling, negative available stock

**Current code (orders.py:197-273):**
```python
def _allocate_order(db: Session, order: OrderModel, user_id: UUID):
    # ❌ NO LOCKING - two requests can read same available_lots
    available_lots = _fefo_available_lots(db, product_id)
    
    for lot_row in available_lots:
        available_qty = Decimal(str(lot_row.qty))  # ❌ Stale read
        allocate_qty = min(available_qty, remaining)
        
        # ❌ Inserts allocate movement without checking current state
        db.add(StockMovementModel(..., movement_type="allocate"))
```

**Scenario:**
1. Order A allocates 100 units from Lot-123 (available: 100)
2. Order B (concurrent) also reads available: 100
3. Both commit → 200 units allocated from 100 available ❌

#### Issue 2.2: No Reserved Quantity Tracking
**Risk:** Cannot distinguish between "allocated but not picked" vs "picked"  
**Impact:** Cancelling orders doesn't properly release reservations

**Current approach:** Uses `allocate`/`unallocate` movements  
**Problem:** No single field shows "currently reserved qty" per lot/location

#### Issue 2.3: Picking Doesn't Validate Against Allocation
**Risk:** Picker can pick more than allocated  
**Impact:** Negative available stock

**Current code (picking.py:214-228):**
```python
# ❌ No check if line.lot_id/location_id has sufficient allocated qty
db.add(StockMovementModel(
    qty_change=-qty_delta,
    movement_type="pick",
))
db.add(StockMovementModel(
    qty_change=-qty_delta,
    movement_type="unallocate",  # ❌ Assumes allocation exists
))
```

---

### ✅ RECOMMENDED APPROACH

#### Option A: Add `reserved_qty` Column (RECOMMENDED)

**Pros:** Simple, fast queries, clear semantics  
**Cons:** Denormalized (must sync with movements)

**Migration:** `backend/alembic/versions/20260211_0024_add_reserved_qty.py`

```python
"""Add reserved_qty to stock_lots for fast allocation checks.

Revision ID: 20260211_0024
Revises: 20260211_0023
"""
from alembic import op
import sqlalchemy as sa

revision = "20260211_0024"
down_revision = "20260211_0023"

def upgrade():
    # Add reserved_qty tracking per lot/location
    op.create_table(
        "stock_reservations",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("product_id", sa.UUID(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("lot_id", sa.UUID(), sa.ForeignKey("stock_lots.id"), nullable=False),
        sa.Column("location_id", sa.UUID(), sa.ForeignKey("locations.id"), nullable=False),
        sa.Column("reserved_qty", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("lot_id", "location_id", name="uq_reservations_lot_location"),
        sa.CheckConstraint("reserved_qty >= 0", name="ck_reserved_qty_positive"),
    )
    op.create_index("ix_reservations_product", "stock_reservations", ["product_id"])
    op.create_index("ix_reservations_lot_location", "stock_reservations", ["lot_id", "location_id"])

def downgrade():
    op.drop_table("stock_reservations")
```

**Updated Model:** `backend/app/models/stock.py`

```python
class StockReservation(Base):
    __tablename__ = "stock_reservations"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    lot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stock_lots.id"), nullable=False)
    location_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)
    reserved_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    
    __table_args__ = (
        UniqueConstraint("lot_id", "location_id", name="uq_reservations_lot_location"),
        CheckConstraint("reserved_qty >= 0", name="ck_reserved_qty_positive"),
    )
```

**Updated Allocation Logic:** `backend/app/api/v1/endpoints/orders.py`

```python
from sqlalchemy import select
from app.models.stock import StockReservation

def _allocate_order_safe(
    db: Session,
    order: OrderModel,
    user_id: UUID,
) -> tuple[list[DocumentLineModel], list[AllocationShortage]]:
    """Thread-safe allocation with row-level locking."""
    shortages: list[AllocationShortage] = []
    document_lines: list[DocumentLineModel] = []

    for line in order.lines:
        product_id = _resolve_product_id(db, line)
        if not product_id:
            shortages.append(AllocationShortage(
                line_id=line.id, sku=line.sku, barcode=line.barcode,
                required_qty=line.qty, allocated_qty=0
            ))
            continue

        remaining = Decimal(str(line.qty))
        allocated_total = Decimal("0")
        
        # CRITICAL: Lock available lots in FEFO order
        available_lots = (
            db.query(
                StockMovementModel.lot_id,
                StockMovementModel.location_id,
                func.sum(StockMovementModel.qty_change).label("on_hand"),
                StockLotModel.batch,
                StockLotModel.expiry_date,
                LocationModel.code.label("location_code"),
            )
            .join(StockLotModel, StockLotModel.id == StockMovementModel.lot_id)
            .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
            .outerjoin(
                StockReservation,
                (StockReservation.lot_id == StockMovementModel.lot_id) &
                (StockReservation.location_id == StockMovementModel.location_id)
            )
            .filter(
                StockLotModel.product_id == product_id,
                StockMovementModel.movement_type.notin_(("allocate", "unallocate")),
            )
            .group_by(
                StockMovementModel.lot_id,
                StockMovementModel.location_id,
                StockLotModel.batch,
                StockLotModel.expiry_date,
                LocationModel.code,
                StockReservation.reserved_qty,
            )
            .having(
                func.sum(StockMovementModel.qty_change) - 
                func.coalesce(StockReservation.reserved_qty, 0) > 0
            )
            .order_by(
                StockLotModel.expiry_date.asc().nullslast(),
                LocationModel.code.asc()
            )
            .with_for_update(skip_locked=True)  # ✅ CRITICAL: Row-level lock
            .all()
        )

        for lot_row in available_lots:
            if remaining <= 0:
                break
            
            # Get or create reservation record with lock
            reservation = (
                db.query(StockReservation)
                .filter(
                    StockReservation.lot_id == lot_row.lot_id,
                    StockReservation.location_id == lot_row.location_id,
                )
                .with_for_update()
                .one_or_none()
            )
            
            if not reservation:
                reservation = StockReservation(
                    product_id=product_id,
                    lot_id=lot_row.lot_id,
                    location_id=lot_row.location_id,
                    reserved_qty=Decimal("0"),
                )
                db.add(reservation)
                db.flush()
            
            on_hand = Decimal(str(lot_row.on_hand))
            available_qty = on_hand - reservation.reserved_qty
            
            if available_qty <= 0:
                continue
            
            allocate_qty = min(available_qty, remaining)
            
            # Update reservation
            reservation.reserved_qty += allocate_qty
            reservation.updated_at = func.now()
            
            # Create document line
            document_lines.append(
                DocumentLineModel(
                    product_id=product_id,
                    lot_id=lot_row.lot_id,
                    location_id=lot_row.location_id,
                    sku=line.sku,
                    product_name=line.name,
                    barcode=line.barcode,
                    location_code=lot_row.location_code or "",
                    batch=lot_row.batch,
                    expiry_date=lot_row.expiry_date,
                    required_qty=float(allocate_qty),
                    picked_qty=0,
                )
            )
            
            # Log allocation movement (for audit trail)
            db.add(
                StockMovementModel(
                    product_id=product_id,
                    lot_id=lot_row.lot_id,
                    location_id=lot_row.location_id,
                    qty_change=allocate_qty,
                    movement_type="allocate",
                    source_document_type="order",
                    source_document_id=order.id,
                    created_by_user_id=user_id,
                )
            )
            
            allocated_total += allocate_qty
            remaining -= allocate_qty

        if allocated_total < Decimal(str(line.qty)):
            shortages.append(
                AllocationShortage(
                    line_id=line.id,
                    sku=line.sku,
                    barcode=line.barcode,
                    required_qty=line.qty,
                    allocated_qty=float(allocated_total),
                )
            )

    return document_lines, shortages
```

**Updated Picking Logic:** `backend/app/api/v1/endpoints/picking.py`

```python
# In pick_line() function, add validation:

# After line 213 (before creating movements):
from app.models.stock import StockReservation

# Validate reservation exists
reservation = (
    db.query(StockReservation)
    .filter(
        StockReservation.lot_id == line.lot_id,
        StockReservation.location_id == line.location_id,
    )
    .with_for_update()
    .one_or_none()
)

if not reservation or reservation.reserved_qty < qty_delta:
    raise HTTPException(
        status_code=409, 
        detail="Insufficient reserved stock for this pick"
    )

# Decrease reservation
reservation.reserved_qty -= qty_delta
reservation.updated_at = func.now()

# Then proceed with existing movement creation...
```

#### Option B: Allocations Table (Alternative)

**Pros:** Explicit allocation records, easier to audit  
**Cons:** More complex queries, harder to maintain consistency

**Schema:**
```python
class StockAllocation(Base):
    __tablename__ = "stock_allocations"
    
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id"))
    document_line_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("document_lines.id"))
    product_id: Mapped[uuid.UUID]
    lot_id: Mapped[uuid.UUID]
    location_id: Mapped[uuid.UUID]
    allocated_qty: Mapped[Decimal]
    picked_qty: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    status: Mapped[str]  # 'allocated', 'picking', 'picked', 'cancelled'
    created_at: Mapped[datetime]
```

**Recommendation:** Use **Option A (reserved_qty)** for MVP simplicity.

---

## 3. OFFLINE SYNC CONFLICT STRATEGY

### Current State Analysis ❌ NOT IMPLEMENTED

**Finding:** Offline queue page exists but has **no sync logic**.

**Current code (OfflineQueuePage.tsx):**
```typescript
export function OfflineQueuePage() {
  const { t } = useTranslation('common')
  return <div>{t('labels.offline_queue')}</div>  // ❌ Empty placeholder
}
```

**Critical Missing Features:**
1. No local storage of pending movements
2. No conflict detection on sync
3. No retry mechanism for failed syncs
4. No UI to show/resolve conflicts

---

### ✅ RECOMMENDED CONFLICT TYPES & RESOLUTION

#### Conflict Type 1: Stale Allocation
**Scenario:** Offline picker tries to pick from lot that was fully allocated online

**Detection:**
```typescript
// Client sends:
{ request_id: "uuid-1", line_id: "line-123", delta: 1 }

// Server responds:
{ error: "InsufficientReservedStock", available: 0, requested: 1 }
```

**Resolution:**
- **Auto:** Reject pick, show error to user
- **Manual:** Allow supervisor to re-allocate from different lot

#### Conflict Type 2: Duplicate request_id
**Scenario:** Same pick action synced twice due to network retry

**Detection:**
```python
# picking.py:160-185 - Already handled ✅
existing_request = db.query(PickRequest).filter(
    PickRequest.request_id == payload.request_id
).one_or_none()

if existing_request:
    # Return idempotent response
    return PickLineResponse(...)
```

**Resolution:** Idempotent - return existing result

#### Conflict Type 3: Document Status Changed
**Scenario:** Offline picker works on document that was cancelled online

**Detection:**
```python
if document.status == "cancelled":
    raise HTTPException(status_code=409, detail="Document cancelled")
```

**Resolution:**
- **Auto:** Reject all pending picks for that document
- **UI:** Show "Document no longer available" banner

#### Conflict Type 4: Inventory Adjusted
**Scenario:** Offline picker picks 10, but online adjustment reduced stock to 5

**Detection:**
```python
available = get_available_qty(db, product_id, lot_id, location_id)
if available < required_qty:
    raise InsufficientStockError(...)
```

**Resolution:**
- **Auto:** Partial pick (pick available qty only)
- **Manual:** Supervisor approves shortage

---

### ✅ IMPLEMENTATION: Offline Queue System

**File:** `mobile-pwa/src/services/offlineQueue.ts` (NEW)

```typescript
import { v4 as uuidv4 } from 'uuid';

export interface QueuedPickAction {
  id: string;
  request_id: string;
  line_id: string;
  delta: 1 | -1;
  timestamp: number;
  status: 'pending' | 'syncing' | 'success' | 'conflict' | 'error';
  error?: string;
  retryCount: number;
}

const QUEUE_KEY = 'wms_offline_queue';
const MAX_RETRIES = 3;

export class OfflineQueue {
  private queue: QueuedPickAction[] = [];

  constructor() {
    this.loadQueue();
  }

  private loadQueue(): void {
    const stored = localStorage.getItem(QUEUE_KEY);
    if (stored) {
      this.queue = JSON.parse(stored);
    }
  }

  private saveQueue(): void {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
  }

  enqueue(lineId: string, delta: 1 | -1): string {
    const requestId = uuidv4();
    const action: QueuedPickAction = {
      id: uuidv4(),
      request_id: requestId,
      line_id: lineId,
      delta,
      timestamp: Date.now(),
      status: 'pending',
      retryCount: 0,
    };
    this.queue.push(action);
    this.saveQueue();
    return requestId;
  }

  async syncAll(): Promise<{ success: number; failed: number; conflicts: number }> {
    let success = 0;
    let failed = 0;
    let conflicts = 0;

    const pending = this.queue.filter(a => 
      a.status === 'pending' || a.status === 'error'
    );

    for (const action of pending) {
      if (action.retryCount >= MAX_RETRIES) {
        action.status = 'error';
        action.error = 'Max retries exceeded';
        failed++;
        continue;
      }

      action.status = 'syncing';
      action.retryCount++;
      this.saveQueue();

      try {
        const response = await fetch(`/api/v1/picking/lines/${action.line_id}/pick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            delta: action.delta,
            request_id: action.request_id,
          }),
        });

        if (response.ok) {
          action.status = 'success';
          success++;
        } else if (response.status === 409) {
          const error = await response.json();
          action.status = 'conflict';
          action.error = error.detail;
          conflicts++;
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        action.status = 'error';
        action.error = String(error);
        failed++;
      }

      this.saveQueue();
    }

    return { success, failed, conflicts };
  }

  getQueue(): QueuedPickAction[] {
    return [...this.queue];
  }

  clearSuccessful(): void {
    this.queue = this.queue.filter(a => a.status !== 'success');
    this.saveQueue();
  }

  retryAction(actionId: string): void {
    const action = this.queue.find(a => a.id === actionId);
    if (action) {
      action.status = 'pending';
      action.retryCount = 0;
      action.error = undefined;
      this.saveQueue();
    }
  }

  removeAction(actionId: string): void {
    this.queue = this.queue.filter(a => a.id !== actionId);
    this.saveQueue();
  }
}

export const offlineQueue = new OfflineQueue();
```

**Updated UI:** `mobile-pwa/src/pages/offline/OfflineQueuePage.tsx`

```typescript
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { offlineQueue, QueuedPickAction } from '../../services/offlineQueue';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';

export function OfflineQueuePage() {
  const { t } = useTranslation('common');
  const [queue, setQueue] = useState<QueuedPickAction[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: number; failed: number; conflicts: number } | null>(null);

  useEffect(() => {
    loadQueue();
  }, []);

  const loadQueue = () => {
    setQueue(offlineQueue.getQueue());
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await offlineQueue.syncAll();
      setSyncResult(result);
      loadQueue();
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncing(false);
    }
  };

  const handleRetry = (actionId: string) => {
    offlineQueue.retryAction(actionId);
    loadQueue();
  };

  const handleRemove = (actionId: string) => {
    offlineQueue.removeAction(actionId);
    loadQueue();
  };

  const handleClearSuccessful = () => {
    offlineQueue.clearSuccessful();
    loadQueue();
  };

  const pendingCount = queue.filter(a => a.status === 'pending' || a.status === 'error').length;
  const conflictCount = queue.filter(a => a.status === 'conflict').length;

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">{t('labels.offline_queue')}</h1>

      <div className="mb-4 flex gap-2">
        <Button onClick={handleSync} disabled={syncing || pendingCount === 0}>
          {syncing ? t('buttons.syncing') : t('buttons.sync_now')} ({pendingCount})
        </Button>
        <Button onClick={handleClearSuccessful} variant="outline">
          {t('buttons.clear_successful')}
        </Button>
      </div>

      {syncResult && (
        <Card className="mb-4 p-4">
          <h3 className="font-semibold mb-2">{t('labels.sync_result')}</h3>
          <p>✅ {t('labels.success')}: {syncResult.success}</p>
          <p>❌ {t('labels.failed')}: {syncResult.failed}</p>
          <p>⚠️ {t('labels.conflicts')}: {syncResult.conflicts}</p>
        </Card>
      )}

      {conflictCount > 0 && (
        <div className="mb-4 p-4 bg-yellow-100 border border-yellow-400 rounded">
          <p className="font-semibold">⚠️ {conflictCount} {t('labels.conflicts_detected')}</p>
          <p className="text-sm">{t('messages.contact_supervisor')}</p>
        </div>
      )}

      <div className="space-y-2">
        {queue.map(action => (
          <Card key={action.id} className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-mono text-sm">{action.line_id.slice(0, 8)}...</p>
                <p className="text-sm text-gray-600">
                  {action.delta > 0 ? '➕' : '➖'} {Math.abs(action.delta)} unit
                </p>
                <p className="text-xs text-gray-500">
                  {new Date(action.timestamp).toLocaleString()}
                </p>
                {action.error && (
                  <p className="text-xs text-red-600 mt-1">{action.error}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`px-2 py-1 rounded text-xs font-semibold ${
                  action.status === 'success' ? 'bg-green-100 text-green-800' :
                  action.status === 'conflict' ? 'bg-yellow-100 text-yellow-800' :
                  action.status === 'error' ? 'bg-red-100 text-red-800' :
                  action.status === 'syncing' ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {action.status.toUpperCase()}
                </span>
                {(action.status === 'error' || action.status === 'conflict') && (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => handleRetry(action.id)}>
                      {t('buttons.retry')}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleRemove(action.id)}>
                      {t('buttons.remove')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {queue.length === 0 && (
        <p className="text-center text-gray-500 mt-8">{t('messages.queue_empty')}</p>
      )}
    </div>
  );
}
```

**Conflict Resolution UI:** Show conflicts with actions:
- **Retry:** Re-attempt sync (for transient errors)
- **Remove:** Discard action (for invalid picks)
- **Contact Supervisor:** Escalate (for complex conflicts)

---

## 4. IDEMPOTENCY VERIFICATION

### Current State Analysis ⚠️ PARTIAL IMPLEMENTATION

**Finding:** Only `/picking/lines/{id}/pick` has idempotency via `request_id`.

#### ✅ Endpoints WITH Idempotency

1. **POST /picking/lines/{line_id}/pick**
   - Uses `PickRequest.request_id` (unique index)
   - Returns existing result if duplicate

#### ❌ Endpoints MISSING Idempotency

1. **POST /receiving/receipts** (Line 125-168)
   - Uses `doc_no` for deduplication
   - ❌ Problem: `doc_no` can be auto-generated, not client-controlled
   - **Risk:** Duplicate receipts if network retry

2. **POST /receiving/receipts/{id}/complete** (Line 177-243)
   - Has guard: checks existing movements
   - ✅ Safe from double-posting
   - ❌ But no `request_id` for client retry safety

3. **POST /inventory/movements** (Line 270-315)
   - ❌ No idempotency key
   - **Risk:** Duplicate adjustments on retry

4. **POST /orders/{id}/send-to-picking** (Line 408-460)
   - Has guard: checks existing document
   - ✅ Safe from double-allocation
   - ❌ But allocation race condition (see Issue 2.1)

5. **POST /orders/{id}/ship** (Line 493-557)
   - Has guard: checks existing ship movements
   - ✅ Safe from double-shipping

---

### ✅ REQUIRED DB CONSTRAINTS

**File:** `backend/alembic/versions/20260211_0025_add_idempotency_keys.py` (NEW)

```python
"""Add idempotency keys to critical operations.

Revision ID: 20260211_0025
Revises: 20260211_0024
"""
from alembic import op
import sqlalchemy as sa

revision = "20260211_0025"
down_revision = "20260211_0024"

def upgrade():
    # 1. Add request_id to receipts table
    op.add_column(
        "receipts",
        sa.Column("request_id", sa.String(64), nullable=True)
    )
    op.create_index(
        "ix_receipts_request_id",
        "receipts",
        ["request_id"],
        unique=True,
        postgresql_where=sa.text("request_id IS NOT NULL")
    )
    
    # 2. Add request_id to stock_movements table
    op.add_column(
        "stock_movements",
        sa.Column("request_id", sa.String(64), nullable=True)
    )
    op.create_index(
        "ix_stock_movements_request_id",
        "stock_movements",
        ["request_id"],
        unique=True,
        postgresql_where=sa.text("request_id IS NOT NULL")
    )
    
    # 3. Add request_id to documents table (for allocation)
    op.add_column(
        "documents",
        sa.Column("request_id", sa.String(64), nullable=True)
    )
    op.create_index(
        "ix_documents_request_id",
        "documents",
        ["request_id"],
        unique=True,
        postgresql_where=sa.text("request_id IS NOT NULL")
    )

def downgrade():
    op.drop_index("ix_documents_request_id", table_name="documents")
    op.drop_column("documents", "request_id")
    op.drop_index("ix_stock_movements_request_id", table_name="stock_movements")
    op.drop_column("stock_movements", "request_id")
    op.drop_index("ix_receipts_request_id", table_name="receipts")
    op.drop_column("receipts", "request_id")
```

**Updated Models:**

```python
# backend/app/models/receipt.py
class Receipt(Base):
    # ... existing fields ...
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    
    __table_args__ = (
        Index("ix_receipts_request_id", "request_id", unique=True, 
              postgresql_where=text("request_id IS NOT NULL")),
    )

# backend/app/models/stock.py
class StockMovement(Base):
    # ... existing fields ...
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    
    __table_args__ = (
        # ... existing indexes ...
        Index("ix_stock_movements_request_id", "request_id", unique=True,
              postgresql_where=text("request_id IS NOT NULL")),
    )

# backend/app/models/document.py
class Document(Base):
    # ... existing fields ...
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    
    __table_args__ = (
        # ... existing constraints ...
        Index("ix_documents_request_id", "request_id", unique=True,
              postgresql_where=text("request_id IS NOT NULL")),
    )
```

**Updated Endpoints:**

```python
# backend/app/api/v1/endpoints/receiving.py

class ReceiptCreate(BaseModel):
    doc_no: Optional[str] = None
    request_id: Optional[str] = None  # ✅ NEW
    lines: List[ReceiptLineCreate]

@router.post("/receipts", ...)
async def create_receipt(payload: ReceiptCreate, ...):
    # Check idempotency first
    if payload.request_id:
        existing = db.query(ReceiptModel).filter(
            ReceiptModel.request_id == payload.request_id
        ).one_or_none()
        if existing:
            return _to_receipt(existing)
    
    doc_no = payload.doc_no.strip() if payload.doc_no else _generate_doc_no()
    
    # ... existing logic ...
    
    receipt = ReceiptModel(
        doc_no=doc_no,
        request_id=payload.request_id,  # ✅ Store request_id
        status="draft",
        created_by=user.id
    )
    # ... rest of logic ...


# backend/app/api/v1/endpoints/inventory.py

class StockMovementCreate(BaseModel):
    # ... existing fields ...
    request_id: Optional[str] = None  # ✅ NEW

@router.post("/movements", ...)
async def create_stock_movement(payload: StockMovementCreate, ...):
    # Check idempotency
    if payload.request_id:
        existing = db.query(StockMovementModel).filter(
            StockMovementModel.request_id == payload.request_id
        ).one_or_none()
        if existing:
            return _to_movement(existing)
    
    # ... existing validation ...
    
    movement = StockMovementModel(
        product_id=payload.product_id,
        lot_id=payload.lot_id,
        location_id=payload.location_id,
        qty_change=payload.qty_change,
        movement_type=payload.movement_type,
        source_document_type=payload.source_document_type,
        source_document_id=payload.source_document_id,
        request_id=payload.request_id,  # ✅ Store request_id
        created_by_user_id=user.id,
    )
    # ... rest of logic ...
```

---

## 5. ACCEPTANCE TEST CHECKLIST

### 20+ End-to-End Test Scenarios

#### A. RECEIVING (5 scenarios)

1. **Basic Receipt**
   - [ ] Create receipt with 3 products, 2 batches each
   - [ ] Complete receipt
   - [ ] Verify stock movements created (6 movements)
   - [ ] Verify inventory summary shows correct on_hand

2. **Duplicate Receipt (Idempotency)**
   - [ ] Create receipt with request_id="R1"
   - [ ] Retry same request_id="R1"
   - [ ] Verify only 1 receipt created
   - [ ] Verify both requests return same receipt_id

3. **Double-Complete Prevention**
   - [ ] Create and complete receipt
   - [ ] Attempt to complete again
   - [ ] Verify 409 Conflict error
   - [ ] Verify no duplicate movements

4. **Expired Batch Warning**
   - [ ] Receive batch with expiry_date = today + 15 days
   - [ ] Check inventory details
   - [ ] Verify expiry warning shown (< 30 days)

5. **Invalid Location**
   - [ ] Attempt receipt with inactive location
   - [ ] Verify 400 Bad Request
   - [ ] Verify no movements created

#### B. ALLOCATION & FEFO (5 scenarios)

6. **FEFO Allocation**
   - [ ] Receive 3 batches: expiry 2026-03-01, 2026-02-01, 2026-04-01
   - [ ] Create order for 100 units
   - [ ] Send to picking
   - [ ] Verify allocation picks 2026-02-01 first (FEFO)

7. **Partial Allocation**
   - [ ] Available stock: 50 units
   - [ ] Create order for 100 units
   - [ ] Send to picking
   - [ ] Verify 50 allocated, 50 shortage reported
   - [ ] Verify document status = "partial"

8. **Concurrent Allocation (Race Condition)**
   - [ ] Available stock: 100 units in Lot-A
   - [ ] Simultaneously send 2 orders (100 units each) to picking
   - [ ] Verify only 1 order fully allocated
   - [ ] Verify 2nd order gets shortage
   - [ ] Verify reserved_qty = 100 (not 200)

9. **Multi-Location Allocation**
   - [ ] Stock: Loc-A (30 units), Loc-B (70 units), same batch
   - [ ] Order: 100 units
   - [ ] Verify allocation creates 2 document lines
   - [ ] Verify both locations reserved

10. **Allocation Rollback on Error**
    - [ ] Trigger error during allocation (e.g., invalid picker_id)
    - [ ] Verify no reservations created
    - [ ] Verify no allocate movements logged

#### C. PICKING (5 scenarios)

11. **Basic Picking**
    - [ ] Allocate order with 3 lines
    - [ ] Pick each line (delta=+1 until complete)
    - [ ] Verify picked_qty increments
    - [ ] Verify document status → "in_progress" → "completed"

12. **Idempotent Pick**
    - [ ] Pick line with request_id="P1"
    - [ ] Retry same request_id="P1"
    - [ ] Verify picked_qty incremented only once
    - [ ] Verify both requests return same response

13. **Pick More Than Required**
    - [ ] Line required_qty = 10
    - [ ] Attempt to pick 11th unit
    - [ ] Verify 400 Bad Request
    - [ ] Verify picked_qty = 10 (unchanged)

14. **Pick Without Allocation**
    - [ ] Create document line without allocation
    - [ ] Attempt to pick
    - [ ] Verify 409 Conflict (missing allocation details)

15. **Concurrent Picking (Same Line)**
    - [ ] 2 pickers simultaneously pick same line
    - [ ] Verify only 1 pick succeeds per request_id
    - [ ] Verify picked_qty accurate

#### D. SHIPPING (2 scenarios)

16. **Ship Completed Order**
    - [ ] Complete picking
    - [ ] Pack order
    - [ ] Ship order
    - [ ] Verify ship movements created (negative qty)
    - [ ] Verify on_hand decreased

17. **Prevent Double-Ship**
    - [ ] Ship order
    - [ ] Attempt to ship again
    - [ ] Verify 409 Conflict
    - [ ] Verify no duplicate ship movements

#### E. OFFLINE SYNC (4 scenarios)

18. **Offline Pick Queue**
    - [ ] Go offline
    - [ ] Pick 5 lines
    - [ ] Verify actions queued locally
    - [ ] Go online
    - [ ] Sync queue
    - [ ] Verify all 5 picks synced successfully

19. **Sync Conflict: Document Cancelled**
    - [ ] Go offline
    - [ ] Pick 3 lines from document-A
    - [ ] Online: Cancel document-A
    - [ ] Go online
    - [ ] Sync queue
    - [ ] Verify conflict detected
    - [ ] Verify UI shows "Document cancelled"

20. **Sync Conflict: Insufficient Stock**
    - [ ] Go offline
    - [ ] Pick 10 units from Lot-X
    - [ ] Online: Adjust Lot-X to -5 units
    - [ ] Go online
    - [ ] Sync queue
    - [ ] Verify conflict: InsufficientReservedStock
    - [ ] Verify UI prompts manual resolution

21. **Duplicate Sync (Network Retry)**
    - [ ] Queue pick with request_id="P1"
    - [ ] Sync (succeeds but client doesn't receive response)
    - [ ] Retry sync with same request_id="P1"
    - [ ] Verify idempotent: no duplicate pick

#### F. RBAC & PERMISSIONS (2 scenarios)

22. **Picker Cannot Access Admin**
    - [ ] Login as picker
    - [ ] Attempt GET /api/v1/inventory/summary
    - [ ] Verify 403 Forbidden

23. **Picker Can Only See Assigned Documents**
    - [ ] Create 2 documents: Doc-A (assigned to Picker-1), Doc-B (assigned to Picker-2)
    - [ ] Login as Picker-1
    - [ ] GET /api/v1/picking/documents
    - [ ] Verify only Doc-A returned

#### G. SMARTUP INTEGRATION (2 scenarios)

24. **Import Orders (Idempotency)**
    - [ ] Sync orders from Smartup (date range)
    - [ ] Verify orders created
    - [ ] Sync same date range again
    - [ ] Verify no duplicates (source_external_id unique)

25. **Update Existing Order**
    - [ ] Import order-123 (status="B#S")
    - [ ] Smartup updates order-123 (new line added)
    - [ ] Re-import order-123
    - [ ] Verify order updated (not duplicated)
    - [ ] Verify new line added

---

## 6. RISK LIST (Prioritized)

### 🔴 CRITICAL (Fix before production)

1. **Race Condition in Allocation** (Issue 2.1)
   - **Impact:** Overselling, negative stock
   - **Probability:** HIGH (multi-user warehouse)
   - **Mitigation:** Implement `reserved_qty` with row-level locking

2. **Missing Idempotency on Adjustments** (Issue 4)
   - **Impact:** Duplicate movements on network retry
   - **Probability:** MEDIUM (mobile network flaky)
   - **Mitigation:** Add `request_id` to `stock_movements`

3. **No Offline Sync Implementation** (Issue 3)
   - **Impact:** Data loss, picker frustration
   - **Probability:** HIGH (warehouse WiFi spotty)
   - **Mitigation:** Implement offline queue with conflict resolution

### 🟡 HIGH (Fix within 2 weeks)

4. **Stock Balances View Incorrect** (Issue 1.3)
   - **Impact:** Wrong available qty displayed
   - **Probability:** MEDIUM (depends on allocate/pick patterns)
   - **Mitigation:** Fix view to exclude allocate/unallocate

5. **No Validation on Negative Stock** (Issue 1.1)
   - **Impact:** Phantom inventory
   - **Probability:** MEDIUM (if allocation fails)
   - **Mitigation:** Add application-level validation before movements

6. **Missing Composite Index** (Issue 1.2)
   - **Impact:** Slow queries (timeout on large datasets)
   - **Probability:** HIGH (as data grows)
   - **Mitigation:** Add balance calculation index

### 🟢 MEDIUM (Fix within 1 month)

7. **No Audit Trail for Allocation Changes**
   - **Impact:** Cannot trace who allocated/deallocated
   - **Probability:** LOW (but important for compliance)
   - **Mitigation:** Log all reservation changes

8. **No Expiry Date Validation**
   - **Impact:** Receiving expired products
   - **Probability:** LOW (manual process)
   - **Mitigation:** Add warning if expiry < today + 7 days

9. **No Batch Number Validation**
   - **Impact:** Duplicate batch numbers across products
   - **Probability:** LOW (unique constraint exists per product)
   - **Mitigation:** Add UI validation

10. **No Location Capacity Tracking**
    - **Impact:** Overfilling locations
    - **Probability:** LOW (manual management)
    - **Mitigation:** Add capacity field to locations

---

## 7. PRIORITIZED ROADMAP

### Phase 1: Critical Fixes (Week 1-2)

**Goal:** Make system safe for multi-user production

1. **Day 1-3: Fix Allocation Race Condition**
   - [ ] Create migration: Add `stock_reservations` table
   - [ ] Update `_allocate_order()` with row-level locking
   - [ ] Update picking to validate reservations
   - [ ] Test scenario #8 (concurrent allocation)

2. **Day 4-5: Add Idempotency Keys**
   - [ ] Create migration: Add `request_id` columns
   - [ ] Update receiving endpoint
   - [ ] Update inventory movements endpoint
   - [ ] Test scenarios #2, #12, #21

3. **Day 6-7: Fix Stock Balances View**
   - [ ] Create migration: Fix view calculation
   - [ ] Add composite index for performance
   - [ ] Test inventory queries with allocations

### Phase 2: Offline Sync (Week 3-4)

**Goal:** Enable reliable offline operations

4. **Day 8-10: Implement Offline Queue**
   - [ ] Create `offlineQueue.ts` service
   - [ ] Update `PickItemPage` to use queue when offline
   - [ ] Add local storage persistence
   - [ ] Test scenario #18

5. **Day 11-12: Conflict Detection & Resolution**
   - [ ] Implement conflict detection logic
   - [ ] Update `OfflineQueuePage` UI
   - [ ] Add retry/remove actions
   - [ ] Test scenarios #19, #20

6. **Day 13-14: Sync Optimization**
   - [ ] Add batch sync endpoint
   - [ ] Implement exponential backoff
   - [ ] Add sync status indicators

### Phase 3: Validation & Monitoring (Week 5-6)

**Goal:** Prevent data corruption

7. **Day 15-17: Stock Validation Service**
   - [ ] Create `inventory_validator.py`
   - [ ] Add pre-movement validation
   - [ ] Add negative stock prevention
   - [ ] Test edge cases

8. **Day 18-20: Audit & Logging**
   - [ ] Add structured logging for all movements
   - [ ] Create audit trail report
   - [ ] Add alerting for negative stock

9. **Day 21-22: Performance Optimization**
   - [ ] Add missing indexes
   - [ ] Optimize FEFO query
   - [ ] Load test with 100K movements

### Phase 4: Testing & Documentation (Week 7-8)

10. **Day 23-28: Acceptance Testing**
    - [ ] Execute all 25 test scenarios
    - [ ] Fix discovered bugs
    - [ ] Document test results

11. **Day 29-30: Production Readiness**
    - [ ] Security audit
    - [ ] Backup/restore procedures
    - [ ] Deployment checklist

---

## 8. CODE PATCHES SUMMARY

### Critical Patches to Apply Immediately

1. **`backend/alembic/versions/20260211_0022_add_balance_index.py`**
   - Adds composite index for balance calculations
   - Adds partial index for on_hand queries

2. **`backend/alembic/versions/20260211_0023_fix_balances_view.py`**
   - Fixes stock_balances view to correctly calculate available qty

3. **`backend/alembic/versions/20260211_0024_add_reserved_qty.py`**
   - Adds `stock_reservations` table for allocation tracking

4. **`backend/app/services/inventory_validator.py`** (NEW)
   - Adds stock validation service with negative stock prevention

5. **`backend/app/api/v1/endpoints/orders.py`**
   - Replace `_allocate_order()` with `_allocate_order_safe()`
   - Adds row-level locking and reservation tracking

6. **`backend/app/api/v1/endpoints/picking.py`**
   - Add reservation validation before picking (line ~213)

7. **`backend/alembic/versions/20260211_0025_add_idempotency_keys.py`**
   - Adds `request_id` to receipts, movements, documents

8. **`backend/app/api/v1/endpoints/receiving.py`**
   - Add `request_id` to `ReceiptCreate` schema
   - Add idempotency check in `create_receipt()`

9. **`backend/app/api/v1/endpoints/inventory.py`**
   - Add `request_id` to `StockMovementCreate` schema
   - Add idempotency check in `create_stock_movement()`

10. **`mobile-pwa/src/services/offlineQueue.ts`** (NEW)
    - Implements offline queue with conflict detection

11. **`mobile-pwa/src/pages/offline/OfflineQueuePage.tsx`**
    - Replace placeholder with full queue UI

---

## 9. TESTING STRATEGY

### Unit Tests (Backend)

```python
# tests/test_allocation.py

def test_concurrent_allocation_race_condition(db_session):
    """Test that concurrent allocations don't oversell."""
    # Setup: 100 units available
    product = create_product(db_session)
    lot = create_lot(db_session, product.id, qty=100)
    
    # Create 2 orders simultaneously
    order1 = create_order(db_session, product.id, qty=100)
    order2 = create_order(db_session, product.id, qty=100)
    
    # Allocate in parallel threads
    with ThreadPoolExecutor(max_workers=2) as executor:
        future1 = executor.submit(_allocate_order_safe, db_session, order1, user_id)
        future2 = executor.submit(_allocate_order_safe, db_session, order2, user_id)
        
        result1 = future1.result()
        result2 = future2.result()
    
    # Verify: Only 100 units allocated total
    total_allocated = sum(line.required_qty for line in result1[0]) + \
                      sum(line.required_qty for line in result2[0])
    assert total_allocated == 100
    
    # Verify: One order has shortage
    assert len(result1[1]) > 0 or len(result2[1]) > 0


def test_idempotent_pick(db_session):
    """Test that duplicate pick requests are idempotent."""
    line = create_allocated_line(db_session)
    request_id = "test-request-123"
    
    # Pick twice with same request_id
    response1 = pick_line(db_session, line.id, request_id, delta=1)
    response2 = pick_line(db_session, line.id, request_id, delta=1)
    
    # Verify: picked_qty = 1 (not 2)
    assert response1.line.qty_picked == 1
    assert response2.line.qty_picked == 1
    
    # Verify: Only 1 PickRequest record
    count = db_session.query(PickRequest).filter(
        PickRequest.request_id == request_id
    ).count()
    assert count == 1
```

### Integration Tests (E2E)

```typescript
// tests/e2e/offline-sync.spec.ts

describe('Offline Sync', () => {
  it('should queue picks when offline and sync when online', async () => {
    // Setup
    await loginAsPicker();
    const document = await createTestDocument();
    
    // Go offline
    await page.setOfflineMode(true);
    
    // Pick 3 lines
    await pickLine(document.lines[0].id);
    await pickLine(document.lines[1].id);
    await pickLine(document.lines[2].id);
    
    // Verify queued locally
    const queue = await page.evaluate(() => 
      JSON.parse(localStorage.getItem('wms_offline_queue'))
    );
    expect(queue).toHaveLength(3);
    
    // Go online
    await page.setOfflineMode(false);
    
    // Sync
    await page.click('[data-testid="sync-button"]');
    await page.waitForSelector('[data-testid="sync-success"]');
    
    // Verify synced
    const response = await api.get(`/picking/documents/${document.id}`);
    expect(response.data.lines[0].qty_picked).toBe(1);
    expect(response.data.lines[1].qty_picked).toBe(1);
    expect(response.data.lines[2].qty_picked).toBe(1);
  });
  
  it('should detect conflict when document cancelled', async () => {
    // Setup
    const document = await createTestDocument();
    await page.setOfflineMode(true);
    
    // Pick offline
    await pickLine(document.lines[0].id);
    
    // Cancel document online
    await api.post(`/documents/${document.id}/cancel`);
    
    // Go online and sync
    await page.setOfflineMode(false);
    await page.click('[data-testid="sync-button"]');
    
    // Verify conflict detected
    await expect(page.locator('[data-testid="conflict-alert"]')).toBeVisible();
    await expect(page.locator('text=Document cancelled')).toBeVisible();
  });
});
```

---

## 10. DEPLOYMENT CHECKLIST

### Pre-Deployment

- [ ] Run all 25 acceptance tests
- [ ] Load test with 10K+ movements
- [ ] Backup production database
- [ ] Review all migrations
- [ ] Test rollback procedure

### Deployment Steps

1. [ ] Apply migrations in order:
   - 20260211_0022 (indexes)
   - 20260211_0023 (view fix)
   - 20260211_0024 (reservations)
   - 20260211_0025 (idempotency)

2. [ ] Deploy backend code
3. [ ] Deploy frontend code
4. [ ] Smoke test critical paths
5. [ ] Monitor error logs for 24h

### Post-Deployment

- [ ] Verify no negative stock
- [ ] Check allocation performance
- [ ] Monitor offline sync success rate
- [ ] Review audit logs

---

## CONCLUSION

The WMS system has a **solid event-sourced foundation** but requires **7 critical fixes** before production deployment with multiple users. The most urgent issues are:

1. **Allocation race condition** → Implement `reserved_qty` with locking
2. **Missing idempotency** → Add `request_id` to all write operations
3. **No offline sync** → Implement queue with conflict resolution

**Estimated effort:** 6-8 weeks for full implementation and testing.

**Recommended approach:** Follow the phased roadmap, prioritizing Phase 1 (critical fixes) before enabling multi-user access.

---

**Report Generated:** February 11, 2026  
**Auditor:** WMS System Analyst  
**Next Review:** After Phase 1 completion
