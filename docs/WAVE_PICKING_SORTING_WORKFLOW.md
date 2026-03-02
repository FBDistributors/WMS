# Wave Picking + Sorting Zone Workflow

## Overview

Wave picking (batch pick) groups multiple OUT orders into a single wave. Pickers collect aggregated quantities by SKU once, move items to a staging/sorting location, then operators in the sorting zone split items into individual orders using barcode scan confirmation.

## Business Rules

- **Barcode-only identification**: All scanning uses barcode. Product identification relies on barcode only.
- **No price display**: Only operational fields (SKU/code, name, brand, qty, location, batch/expiry where needed).
- **FEFO**: First-Expiry-First-Out for picking when batch/expiry exists.
- **Multi-user safe**: Row-level locking and idempotency (request_id) prevent double allocation and double consumption.

## Data Model

### waves
- `id`, `wave_number` (unique), `status` (DRAFT | PICKING | SORTING | COMPLETED | CANCELLED)
- `created_by`, `created_at`, `updated_at`, `note`

### wave_orders
- Links wave to orders (many-to-many)
- Unique (wave_id, order_id)

### wave_lines
- Aggregated pick list by product
- `product_id`, `barcode`, `total_qty`, `picked_qty`, `status` (OPEN | PICKED)

### wave_allocations
- Traceability: which lots/locations allocated per wave line
- `wave_line_id`, `stock_lot_id`, `location_id`, `allocated_qty`, `picked_qty`

### sorting_bins
- Logical order bins in sorting zone
- `wave_id`, `order_id`, `bin_code` (e.g. BIN-001), `status` (OPEN | DONE)

### sorting_scans
- Audit of sorting confirmations
- `wave_id`, `order_id`, `barcode`, `qty`, `scanned_by`, `scanned_at`, `request_id` (idempotency)

### Locations
- Staging/sorting location type: `Z-SORT-01` (or similar)
- Items moved here during batch pick; operators sort from here into order bins.

## Workflow Steps

### 1. Create Wave (Admin)
- Select date range, load orders
- Choose orders eligible for wave (no picking document, not in another wave)
- POST /waves with `order_ids[]`, optional `note`
- Wave created in DRAFT
- Aggregated lines computed by product/barcode
- Sorting bins created (one per order)

### 2. Start Wave (Admin/Supervisor)
- POST /waves/{id}/start
- Status → PICKING
- FEFO allocation per wave line:
  - Lock stock_lots with `SELECT ... FOR UPDATE SKIP LOCKED`
  - Allocate into wave_allocations
  - Create allocate movements
- Returns pick plan (locations, lots)

### 3. Wave Picking (Picker, Mobile)
- Select wave (or open from wave details)
- Scan barcode → match wave_line
- Confirm qty (stepper)
- POST /waves/{id}/pick/scan: `{ barcode, qty, request_id }`
  - Idempotent by request_id
  - Unallocate from source lot/location
  - Transfer to staging (Z-SORT-01)
  - Update picked_qty
- When all lines PICKED → wave status → SORTING

### 4. Sorting Zone (Operator, Desktop/Tablet)
- Select wave
- List bins (orders) with progress
- Select order/bin
- Scan barcode, confirm qty
- POST /waves/{id}/sorting/scan: `{ order_id, barcode, qty, request_id }`
  - Idempotent by request_id
  - Record sorting_scans
  - When order complete → bin status DONE

### 5. Complete Wave (Admin/Supervisor)
- POST /waves/{id}/complete
- Validates all bins DONE
- Wave status → COMPLETED

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /waves | Create wave (DRAFT) |
| GET | /waves | List waves (filter by status) |
| GET | /waves/{id} | Wave details, lines, allocations, bins |
| POST | /waves/{id}/start | Start wave, FEFO allocate |
| POST | /waves/{id}/pick/scan | Picker scan (idempotent) |
| POST | /waves/{id}/sorting/scan | Sorting scan (idempotent) |
| POST | /waves/{id}/complete | Complete wave |

## Performance

- Indexes: wave_orders(wave_id, order_id), wave_lines(wave_id, barcode), sorting_bins(wave_id, order_id), sorting_scans(wave_id, order_id, barcode), stock_lots(product_id, expiry_date, location_id)
- Aggregated lines reduce pick actions vs. order-by-order picking.

## Audit

- `created_by`, `scanned_by`, timestamps
- AuditLog records for create, start, pick, sort, complete.
