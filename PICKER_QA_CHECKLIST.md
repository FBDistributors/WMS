# Picker Inventory & Scan Flow – QA Checklist (Barcode-First)

## Backend API

- [ ] **POST /api/v1/scanner/resolve** – Returns type, product {id,name,barcode,brand}, location {id,code}, message
- [ ] **POST /api/v1/scanner/resolve** – Product barcode → type=PRODUCT, full product object
- [ ] **POST /api/v1/scanner/resolve** – Location code → type=LOCATION, full location object
- [ ] **POST /api/v1/scanner/resolve** – Unknown barcode → type=UNKNOWN, message
- [ ] **GET /api/v1/inventory/by-barcode/{barcode}** – Returns product, best_locations, fefo_lots, total_available
- [ ] **GET /api/v1/inventory/location/{code}** – Returns location contents (optional)
- [ ] **GET /api/v1/inventory/picker** – List returns items with FEFO ordering
- [ ] **GET /api/v1/inventory/picker/{product_id}** – Detail returns locations → lots with available_qty
- [ ] **RBAC** – Picker can access /inventory/picker and /scanner/resolve
- [ ] **RBAC** – Picker cannot access /inventory/summary, /inventory/details (admin endpoints)

## Frontend – Picker Home (Barcode-First)

- [ ] **Route /picker** – Picker home with center scan button (default landing for picker)
- [ ] **Center scan button** – Big scan button like banking app
- [ ] **Scan → PRODUCT** – Calls resolve, then getInventoryByBarcode, shows Result Card
- [ ] **Scan → LOCATION** – Navigates to inventory filtered by location
- [ ] **Scan → UNKNOWN** – Shows error + Retry button
- [ ] **Result Card** – Product name, barcode, locations (top 1–3), nearest expiry lot, total available
- [ ] **Result Card** – Buttons: Back to Scan, View Details (no price/cost)
- [ ] **Quick links** – My pick tasks, Inventory, Offline queue
- [ ] **Offline** – Uses cached barcode→inventory when offline

## Frontend – Picker Inventory UI

- [ ] **Route /picker/inventory** – Accessible for picker role
- [ ] **Search** – Search input filters by name/SKU (Enter or Search button)
- [ ] **Scan button** – Opens camera scan modal
- [ ] **Product scan** – Scan product barcode → navigates to product detail or highlights in list
- [ ] **Location filter** – Dropdown filters by location
- [ ] **Product cards** – Show name, barcode, best_location, available_qty, nearest_expiry
- [ ] **Expand "More locations"** – Shows top 1–3 lots with batch, expiry, available
- [ ] **Detail page /picker/inventory/:productId** – Full breakdown (locations → lots)
- [ ] **Offline** – When offline, cached data shown with "Data may be outdated" warning
- [ ] **Link from Pick list** – "Inventar" link visible on Pick list page

## Mobile Scan Flow (ZXing)

- [ ] **Scan modal** – Opens, camera starts, scans barcode
- [ ] **Product scan mode** – Scan barcode → resolve → if PRODUCT, navigate to detail
- [ ] **Unknown barcode** – Shows error message
- [ ] **Scan Validate component** – Step 1: scan LOCATION, Step 2: scan PRODUCT, Step 3: qty +/-, Confirm

## Offline-First

- [ ] **Barcode cache** – barcode→inventory responses cached in localStorage
- [ ] **TTL** – Cache expires after ~20 minutes
- [ ] **Offline scan** – Scan works against cached barcode entries when offline
- [ ] **Offline display** – "Offline – data may be outdated" warning

## Security & RBAC

- [ ] **Picker blocked from admin** – Cannot access /admin/inventory, /inventory/summary, etc.
- [ ] **Picker can access** – /picker/inventory, /scanner/resolve
- [ ] **Supervisor/warehouse_admin** – Can also access picker inventory (inventory:read)
