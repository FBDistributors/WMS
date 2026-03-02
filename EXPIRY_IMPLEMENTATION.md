# WMS Expiry Date Implementation - Complete Guide

## Executive Summary

✅ **GOOD NEWS**: Your WMS system already has excellent expiry date support! The core infrastructure is in place:
- `stock_lots.expiry_date` column exists (nullable DATE)
- `stock_lots.batch` column exists  
- Unique constraint on `(product_id, batch, expiry_date)` ✅
- FEFO logic implemented in `_fefo_available_lots()` ✅
- Receiving endpoints accept `expiry_date` ✅

## Current State Analysis

### ✅ What's Already Implemented

1. **Database Schema** (`stock_lots` table):
   - ✅ `expiry_date DATE NULL`
   - ✅ `batch VARCHAR(64) NOT NULL`
   - ✅ Unique constraint: `uq_stock_lots_product_batch_expiry`
   - ✅ Index: `ix_stock_lots_expiry_date`
   - ✅ Index: `ix_stock_lots_product_id`

2. **Backend - Receiving Flow**:
   - ✅ `ReceiptLineCreate` schema has `expiry_date: Optional[date]`
   - ✅ `complete_receipt()` finds or creates `StockLot` by `(product_id, batch, expiry_date)`
   - ✅ Receipt lines store `expiry_date`

3. **Backend - FEFO Logic**:
   - ✅ `_fefo_available_lots()` orders by `expiry_date ASC NULLSLAST`
   - ✅ Allocation uses FEFO for picking

### ⚠️ What Needs Enhancement

1. **Expiry Validation** - Missing date validation
2. **FEFO Index Optimization** - Need composite index
3. **Frontend UI** - Expiry not prominently displayed
4. **Tests** - No expiry-specific tests

---

## Implementation Plan

### PHASE 1: Backend Enhancements (CRITICAL)

#### 1.1 Add Expiry Date Validation

**File**: `backend/app/api/v1/endpoints/receiving.py`

Add validation before creating receipt:

```python
# Add after line 133 (after checking if lines are empty)
from datetime import date as date_type

# Validate expiry dates
today = date_type.today()
for line in payload.lines:
    if line.expiry_date and line.expiry_date < today:
        raise HTTPException(
            status_code=400, 
            detail=f"Expiry date {line.expiry_date} is in the past. Product: {line.product_id}"
        )
```

#### 1.2 Add FEFO Optimization Index

**File**: `backend/alembic/versions/20260211_0026_add_fefo_index.py` (NEW)

```python
"""Add composite index for FEFO queries

Revision ID: 20260211_0026
Revises: 20260211_0025
Create Date: 2026-02-11 17:00:00.000000
"""
from alembic import op

revision = "20260211_0026"
down_revision = "20260210_0021"  # Update to your latest migration
branch_labels = None
depends_on = None

def upgrade():
    # Composite index for FEFO: (product_id, expiry_date, id)
    # This optimizes: SELECT * FROM stock_lots WHERE product_id = ? ORDER BY expiry_date ASC
    op.create_index(
        "ix_stock_lots_fefo",
        "stock_lots",
        ["product_id", "expiry_date", "id"],
    )

def downgrade():
    op.drop_index("ix_stock_lots_fefo", table_name="stock_lots")
```

#### 1.3 Update StockLot Model (Documentation)

**File**: `backend/app/models/stock.py`

Add comment to clarify expiry design (no code change needed):

```python
class StockLot(Base):
    """
    Stock Lot (Batch) - represents a specific batch of product with unique expiry.
    
    Design principle: Expiry belongs to LOT, not Product.
    - Same product can have multiple lots with different expiry dates
    - FEFO (First Expired, First Out) uses expiry_date for allocation
    - Unique constraint ensures no duplicate lots: (product_id, batch, expiry_date)
    """
    __tablename__ = "stock_lots"
    # ... rest of code unchanged
```

---

### PHASE 2: Frontend Enhancements

#### 2.1 Receiving Page - Add Expiry Date Picker

**File**: `mobile-pwa/src/pages/admin/ReceivingPage.tsx`

Current implementation already supports expiry (check if UI exists). If missing, add:

```tsx
// In the receiving form, add expiry date input:
<div>
  <label className="text-sm text-slate-600 dark:text-slate-300">
    {t('receiving:expiry_date')}
  </label>
  <input
    type="date"
    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2"
    value={line.expiry_date || ''}
    onChange={(e) => updateLine(index, 'expiry_date', e.target.value)}
    min={new Date().toISOString().split('T')[0]} // Prevent past dates
  />
</div>
```

#### 2.2 Inventory Page - Show Expiry in Table

**File**: `mobile-pwa/src/pages/admin/InventorySummaryPage.tsx` (or similar)

Add expiry column to inventory table:

```tsx
// Add to table columns
<th className="px-4 py-3 text-left">{t('inventory:expiry_date')}</th>

// In table body
<td className="px-4 py-3">
  {row.expiry_date ? (
    <span className={getExpiryColorClass(row.expiry_date)}>
      {new Date(row.expiry_date).toLocaleDateString()}
    </span>
  ) : (
    <span className="text-slate-400">—</span>
  )}
</td>

// Helper function for color coding
function getExpiryColorClass(expiryDate: string): string {
  const today = new Date();
  const expiry = new Date(expiryDate);
  const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysUntilExpiry < 0) return 'text-red-600 font-semibold'; // Expired
  if (daysUntilExpiry <= 30) return 'text-orange-600 font-semibold'; // Expiring soon
  if (daysUntilExpiry <= 90) return 'text-yellow-600'; // Warning
  return 'text-slate-600'; // Normal
}
```

#### 2.3 Picking Page - Show Batch and Expiry

**File**: `mobile-pwa/src/pages/PickItemPage.tsx`

Ensure batch and expiry are prominently displayed:

```tsx
// In pick item card
<div className="mb-4 rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
  <div className="text-xs text-slate-500">Batch / Expiry</div>
  <div className="flex items-center justify-between">
    <div className="font-semibold text-slate-900 dark:text-slate-100">
      {line.batch}
    </div>
    {line.expiry_date && (
      <div className={`text-sm font-medium ${getExpiryColorClass(line.expiry_date)}`}>
        Exp: {new Date(line.expiry_date).toLocaleDateString()}
      </div>
    )}
  </div>
</div>
```

---

### PHASE 3: Testing

#### 3.1 Backend Tests

**File**: `backend/tests/test_expiry.py` (NEW)

```python
import pytest
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

def test_create_lot_with_expiry(db_session, test_product, test_location):
    """Test creating a stock lot with expiry date"""
    from app.models.stock import StockLot
    
    expiry = date.today() + timedelta(days=90)
    lot = StockLot(
        product_id=test_product.id,
        batch="BATCH-001",
        expiry_date=expiry
    )
    db_session.add(lot)
    db_session.commit()
    
    assert lot.id is not None
    assert lot.expiry_date == expiry
    assert lot.batch == "BATCH-001"


def test_prevent_duplicate_lots(db_session, test_product):
    """Test unique constraint on (product_id, batch, expiry_date)"""
    from app.models.stock import StockLot
    from sqlalchemy.exc import IntegrityError
    
    expiry = date.today() + timedelta(days=90)
    
    # Create first lot
    lot1 = StockLot(product_id=test_product.id, batch="BATCH-001", expiry_date=expiry)
    db_session.add(lot1)
    db_session.commit()
    
    # Try to create duplicate - should fail
    lot2 = StockLot(product_id=test_product.id, batch="BATCH-001", expiry_date=expiry)
    db_session.add(lot2)
    
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_fefo_picks_earliest_expiry(db_session, test_product, test_location, test_user):
    """Test FEFO logic picks lot with earliest expiry first"""
    from app.models.stock import StockLot, StockMovement
    from app.api.v1.endpoints.orders import _fefo_available_lots
    
    # Create 3 lots with different expiry dates
    lot1 = StockLot(
        product_id=test_product.id, 
        batch="BATCH-001", 
        expiry_date=date.today() + timedelta(days=30)  # Expires soonest
    )
    lot2 = StockLot(
        product_id=test_product.id, 
        batch="BATCH-002", 
        expiry_date=date.today() + timedelta(days=90)
    )
    lot3 = StockLot(
        product_id=test_product.id, 
        batch="BATCH-003", 
        expiry_date=date.today() + timedelta(days=60)
    )
    db_session.add_all([lot1, lot2, lot3])
    db_session.flush()
    
    # Add stock to each lot
    for lot in [lot1, lot2, lot3]:
        movement = StockMovement(
            product_id=test_product.id,
            lot_id=lot.id,
            location_id=test_location.id,
            qty_change=Decimal("100"),
            movement_type="receipt",
            created_by_user_id=test_user.id
        )
        db_session.add(movement)
    db_session.commit()
    
    # Query FEFO
    available = _fefo_available_lots(db_session, test_product.id)
    
    # First lot should be the one expiring soonest (lot1)
    assert available[0].lot_id == lot1.id
    assert available[0].expiry_date == lot1.expiry_date


def test_receiving_creates_new_lot(client, db_session, test_product, test_location, admin_token):
    """Test receiving creates new lot if not found"""
    expiry = (date.today() + timedelta(days=90)).isoformat()
    
    response = client.post(
        "/api/v1/receiving/receipts",
        json={
            "lines": [{
                "product_id": str(test_product.id),
                "qty": 50,
                "batch": "NEW-BATCH-001",
                "expiry_date": expiry,
                "location_id": str(test_location.id)
            }]
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["lines"][0]["batch"] == "NEW-BATCH-001"
    assert data["lines"][0]["expiry_date"] == expiry


def test_reject_past_expiry_date(client, test_product, test_location, admin_token):
    """Test validation rejects past expiry dates"""
    past_date = (date.today() - timedelta(days=1)).isoformat()
    
    response = client.post(
        "/api/v1/receiving/receipts",
        json={
            "lines": [{
                "product_id": str(test_product.id),
                "qty": 50,
                "batch": "BATCH-001",
                "expiry_date": past_date,
                "location_id": str(test_location.id)
            }]
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 400
    assert "past" in response.json()["detail"].lower()
```

#### 3.2 Frontend Tests

**File**: `mobile-pwa/src/tests/expiry.test.tsx` (NEW)

```typescript
import { render, screen } from '@testing-library/react';
import { getExpiryColorClass } from '../utils/expiry';

describe('Expiry Date Utilities', () => {
  test('expired date shows red', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const color = getExpiryColorClass(yesterday.toISOString());
    expect(color).toContain('red');
  });

  test('expiring soon (< 30 days) shows orange', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 15);
    const color = getExpiryColorClass(soon.toISOString());
    expect(color).toContain('orange');
  });

  test('warning period (30-90 days) shows yellow', () => {
    const warning = new Date();
    warning.setDate(warning.getDate() + 60);
    const color = getExpiryColorClass(warning.toISOString());
    expect(color).toContain('yellow');
  });

  test('normal expiry (> 90 days) shows default color', () => {
    const normal = new Date();
    normal.setDate(normal.getDate() + 120);
    const color = getExpiryColorClass(normal.toISOString());
    expect(color).toContain('slate');
  });
});
```

---

## Migration Safety Plan

### Current State
- `stock_lots.expiry_date` is already `NULL`able ✅
- Existing lots may have `NULL` expiry dates
- No breaking changes needed

### Safe Migration Strategy

**Option 1: Keep NULL (RECOMMENDED)**
- ✅ No migration needed
- ✅ Existing data unaffected
- ✅ New receipts can specify expiry
- ⚠️ NULL means "no expiry tracking" (acceptable for non-perishable items)

**Option 2: Backfill with Default**
- ⚠️ NOT RECOMMENDED - creates fake data
- Would require manual review of each product

**Option 3: Enforce NOT NULL (Future)**
- Only after all products have expiry policy
- Requires product-level configuration first

**DECISION**: Keep current nullable design. It's correct and safe.

---

## Translations

Add to translation files:

**File**: `mobile-pwa/src/i18n/uz/receiving.json`
```json
{
  "expiry_date": "Yaroqlilik muddati",
  "expiry_required": "Yaroqlilik muddati majburiy",
  "expiry_past": "Yaroqlilik muddati o'tgan",
  "batch": "Partiya"
}
```

**File**: `mobile-pwa/src/i18n/en/receiving.json`
```json
{
  "expiry_date": "Expiry Date",
  "expiry_required": "Expiry date is required",
  "expiry_past": "Expiry date is in the past",
  "batch": "Batch"
}
```

**File**: `mobile-pwa/src/i18n/ru/receiving.json`
```json
{
  "expiry_date": "Срок годности",
  "expiry_required": "Срок годности обязателен",
  "expiry_past": "Срок годности истёк",
  "batch": "Партия"
}
```

---

## Summary of Changes

### Files to Create
1. ✅ `backend/alembic/versions/20260211_0026_add_fefo_index.py` - FEFO optimization index
2. ✅ `backend/tests/test_expiry.py` - Comprehensive expiry tests
3. ✅ `mobile-pwa/src/tests/expiry.test.tsx` - Frontend expiry tests
4. ✅ `mobile-pwa/src/utils/expiry.ts` - Expiry utility functions

### Files to Modify
1. ✅ `backend/app/api/v1/endpoints/receiving.py` - Add expiry validation
2. ✅ `backend/app/models/stock.py` - Add documentation comments
3. ✅ `mobile-pwa/src/pages/admin/ReceivingPage.tsx` - Ensure expiry input exists
4. ✅ `mobile-pwa/src/pages/admin/InventorySummaryPage.tsx` - Show expiry in table
5. ✅ `mobile-pwa/src/pages/PickItemPage.tsx` - Show batch/expiry prominently
6. ✅ Translation files (uz/en/ru) - Add expiry labels

### No Changes Needed
- ✅ Database schema (already correct)
- ✅ StockLot model (already has expiry_date)
- ✅ FEFO logic (already implemented correctly)
- ✅ Receipt endpoints (already accept expiry_date)

---

## Implementation Priority

### HIGH PRIORITY (Do First)
1. ✅ Add expiry validation in receiving endpoint
2. ✅ Create FEFO optimization index migration
3. ✅ Add expiry tests

### MEDIUM PRIORITY
4. ✅ Enhance frontend UI to show expiry prominently
5. ✅ Add color-coded expiry warnings
6. ✅ Add translations

### LOW PRIORITY (Nice to Have)
7. ✅ Add expiry reports (items expiring soon)
8. ✅ Add email alerts for expiring stock
9. ✅ Add product-level shelf life configuration

---

## Verification Checklist

After implementation, verify:

- [ ] Can create receipt with expiry date
- [ ] Cannot create receipt with past expiry date
- [ ] FEFO picks earliest expiry first
- [ ] Inventory table shows expiry dates
- [ ] Picking screen shows batch and expiry
- [ ] Expiry dates are color-coded (red/orange/yellow)
- [ ] Duplicate lot constraint works
- [ ] All 5 tests pass
- [ ] Translations work in all 3 languages

---

## Conclusion

**Your WMS already has excellent expiry support!** 🎉

The core architecture is sound:
- ✅ Expiry belongs to StockLot (not Product) - CORRECT DESIGN
- ✅ FEFO logic implemented
- ✅ Unique constraint prevents duplicates
- ✅ Receiving flow supports expiry

**Recommended Next Steps:**
1. Add the validation and index (5 minutes)
2. Add the tests (30 minutes)
3. Enhance UI to show expiry prominently (1 hour)
4. Deploy and verify

Total effort: ~2 hours for complete enhancement.
