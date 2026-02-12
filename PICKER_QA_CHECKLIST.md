# Picker Inventory & Scan Flow – QA Checklist

## Backend API

- [ ] **GET /api/v1/inventory/picker** – List returns items with product_id, name, main_barcode, best_location, available_qty, nearest_expiry, top_locations
- [ ] **GET /api/v1/inventory/picker?q=...** – Search by product name/SKU works
- [ ] **GET /api/v1/inventory/picker?barcode=...** – Exact barcode match works
- [ ] **GET /api/v1/inventory/picker?location_id=...** – Location filter works
- [ ] **GET /api/v1/inventory/picker?limit=20&cursor=...** – Pagination works
- [ ] **GET /api/v1/inventory/picker/{product_id}** – Detail returns locations → lots with on_hand, reserved, available
- [ ] **POST /api/v1/scanner/resolve** – Product barcode returns type=PRODUCT, entity_id
- [ ] **POST /api/v1/scanner/resolve** – Location code returns type=LOCATION, entity_id
- [ ] **POST /api/v1/scanner/resolve** – Unknown barcode returns type=UNKNOWN
- [ ] **RBAC** – Picker can access /inventory/picker and /scanner/resolve
- [ ] **RBAC** – Picker cannot access /inventory/summary, /inventory/details (admin endpoints)

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

- [ ] **Cache** – Last successful /inventory/picker response cached (localStorage)
- [ ] **TTL** – Cache expires after ~20 minutes
- [ ] **Offline display** – Cached items shown with clear "Data may be outdated" warning
- [ ] **Search offline** – Search works against cached items when offline

## Security & RBAC

- [ ] **Picker blocked from admin** – Cannot access /admin/inventory, /inventory/summary, etc.
- [ ] **Picker can access** – /picker/inventory, /scanner/resolve
- [ ] **Supervisor/warehouse_admin** – Can also access picker inventory (inventory:read)
