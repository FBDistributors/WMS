# Inventory Performance Optimization Summary

## Goals

- **Target**: Reduce inventory load time to < 1 second
- **Response size**: < 50KB for summary endpoint
- **Single API call** on initial render
- **Lazy load** location details on row expand

---

## Changes Implemented

### 1. Backend – New Endpoints

#### A) Lightweight Summary

**`GET /api/v1/inventory/summary-light`**

| Param          | Default | Description                     |
|----------------|---------|---------------------------------|
| `limit`        | 50      | Page size                       |
| `offset`       | 0       | Pagination offset               |
| `search`       | -       | Search by SKU or name           |
| `only_available` | true  | Filter to products with qty > 0 |

**Response** (paginated):

- `product_id`, `product_name`, `product_code`, `brand_name`
- `total_qty`, `available_qty`
- **No location breakdown** (reduces payload)

#### B) Per-Product Location Details

**`GET /api/v1/inventory/by-product/{product_id}`**

Called when user expands a row. Returns:

- `location_code`, `location_type`
- `qty`, `available_qty`, `expiry_date`

---

### 2. Database Indexes (Alembic)

**Migration**: `20260214_0034_inventory_perf_indexes.py`

- `ix_locations_code` on `locations(code)`
- Existing indexes from prior migrations:
  - `stock_movements (product_id, lot_id, location_id, created_at)`
  - `stock_lots (product_id, expiry_date)`

---

### 3. Frontend

**`InventorySummaryPage.tsx`**

- Uses `getInventorySummaryLight` instead of `getInventorySummaryByLocation`
- **Debounced search** (400ms)
- **Pagination** (limit 50, prev/next)
- **Row expansion** – fetches `getInventoryByProduct(productId)` only when expanded
- **Single API call** on initial load
- Default: `only_available=true`, `limit=50`

---

### 4. Response Size Reduction

| Before (summary-by-location) | After (summary-light) |
|-----------------------------|------------------------|
| One row per (product, location) | One row per product |
| Full product + location data | Minimal fields only |
| ~180KB typical             | Target < 50KB (50 rows) |

---

## Not Implemented (Future)

- **stock_on_hand** table – would require backfill and hooks in all movement creation points (receiving, orders, picking, adjustments). Left for a later iteration.
- **react-window** – virtualized list when product count > 500. Can be added if needed.

---

## Verification

1. **Run migration**: `alembic upgrade head`
2. **Measure** summary-light: response time and size
3. **Compare** with previous `summary-by-location` metrics

Expected: summary-light should respond in < 1 second and stay under ~50KB for 50 rows.
