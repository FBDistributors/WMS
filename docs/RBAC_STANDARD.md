# WMS RBAC Standard (3 roles: Picker, Controller, Admin)

Backend — yagona haqiqat. Frontend guard ikkinchi daraja.

---

## 1) Final RBAC Matrix (permission → roles)

| Permission | Picker | Controller | Admin |
|------------|--------|------------|-------|
| picking:read | ✅ | ✅ | ✅ |
| picking:write | ✅ | ✅ | ✅ |
| inventory:read | ✅ | ✅ | ✅ |
| inventory:count | ✅ | ✅ | ✅ |
| inventory:adjust | ❌ | ✅ | ✅ |
| inventory:move_zone | ✅ (EXPIRED/DAMAGED only) | ✅ | ✅ |
| receiving:read | ❌ | ✅ | ✅ |
| receiving:write | ❌ | ✅ | ✅ |
| documents:read | ✅ | ✅ | ✅ |
| documents:write_status | ❌ | ✅ | ✅ |
| documents:create | ❌ | ❌ | ✅ |
| orders:read | ❌ | ✅ | ✅ |
| orders:write | ❌ | ✅ | ✅ |
| products:read | ✅ | ✅ | ✅ |
| products:write | ❌ | ❌ | ✅ |
| locations:read | ❌ | ✅ | ✅ |
| locations:write | ❌ | ❌ | ✅ |
| users:read | ❌ | ❌ | ✅ |
| users:write | ❌ | ❌ | ✅ |
| audit:read | ❌ | ✅ | ✅ |
| reports:read | ✅ | ✅ | ✅ |
| integrations:write | ❌ | ❌ | ✅ |
| maintenance:write | ❌ | ❌ | ✅ |
| movements:read | ❌ | ✅ | ✅ |
| brands:manage | ❌ | ❌ | ✅ |
| admin:access | ❌ | ❌ | ✅ |
| waves:read, waves:pick | ✅ | — | ✅ |
| waves:create, waves:manage, waves:sort | ❌ | — | ✅ |

---

## 2) Backend code

### permissions.py (`backend/app/auth/permissions.py`)

- Permission constants: `PERM_PICKING_READ`, `PERM_INVENTORY_ADJUST`, `PERM_MAINTENANCE_WRITE`, etc.
- `PERMISSIONS` set (new + legacy names).
- `LEGACY_EXPANSION`: new → legacy (e.g. `documents:write_status` → `documents:edit_status`) so existing endpoint `Depends(require_permission("documents:edit_status"))` works.
- `ROLE_PERMISSIONS`: picker, inventory_controller, warehouse_admin, supervisor, receiver.
- `get_permissions_for_role(role)` returns base + expanded legacy.

### deps.py (`backend/app/auth/deps.py`)

- `get_current_user` — JWT, session check.
- `require_permission(permission)` — checks `get_permissions_for_role(user.role)`.
- `require_any_permission(permissions)` — OR.
- `require_role(allowed_roles)` — tezkor blok (faqat shu rollar).
- `require_admin_access()` — `require_permission("admin:access")`.

### guards.py (`backend/app/auth/guards.py`)

- `check_controller_adjust_reason(user, reason_code)` — controller faqat `inventory_shortage`, `inventory_overage`.
- `check_picker_move_zone_target(user, target_zone_type, qty)` — picker faqat EXPIRED/DAMAGED; optional max qty.

---

## 3) RBAC patch list (qaysi fayl, qaysi endpoint, qaysi permission)

| File | Endpoint | Change |
|------|----------|--------|
| `auth/permissions.py` | — | New model: 3 roles, LEGACY_EXPANSION, no receiving for picker |
| `auth/deps.py` | — | Added `require_role(allowed_roles)` |
| `auth/guards.py` | — | New: controller adjust reason, picker move_zone |
| `endpoints/inventory.py` | POST /movements | Add `reason_code` to body; call `check_controller_adjust_reason` for type=adjust; save reason_code |
| `endpoints/inventory.py` | POST /fix-duplicate-pick | `require_permission("maintenance:write")` |
| `endpoints/locations.py` | GET list, GET /{id} | `require_any_permission(["locations:read", "locations:manage"])` |
| `endpoints/locations.py` | POST, PUT, PATCH, DELETE | `require_any_permission(["locations:write", "locations:manage"])` |
| `endpoints/users.py` | GET list, GET /{id} | `require_any_permission(["users:read", "users:manage"])` |
| `endpoints/users.py` | POST, PATCH, reset-password, DELETE | Keep `require_permission("users:manage")` |
| `endpoints/integrations.py` | POST /smartup/import | `require_permission("integrations:write")` |
| `endpoints/dashboard.py` | GET /summary, /orders-by-status, /pick-documents | `require_any_permission(["reports:read", "audit:read", "admin:access"])` |

Boshqa routerlar: mavjud `require_permission(...)` saqlanadi (picking, documents, orders, receiving, audit, reports, products, waves, brands). Legacy expansion tufayli `documents:edit_status`, `orders:sync`, `orders:send_to_picking` va h.k. role’da yangi nomlar orqali beriladi.

---

## 4) Router snippet patches (real code)

### inventory.py — create_stock_movement (adjust guard + reason_code)

```python
# In create_stock_movement, after validating location:
if payload.movement_type == "adjust":
    check_controller_adjust_reason(user, payload.reason_code)

movement = StockMovementModel(
    ...
    reason_code=payload.reason_code,
)
```

### inventory.py — StockMovementCreate

```python
class StockMovementCreate(BaseModel):
    ...
    reason_code: Optional[str] = Field(default=None, max_length=64)
```

### inventory.py — fix_duplicate_pick

```python
_user=Depends(require_permission("maintenance:write")),
```

### locations.py — GET vs write

```python
# GET list / GET {id}
_user=Depends(require_any_permission(["locations:read", "locations:manage"])),

# POST / PUT / PATCH / DELETE
user=Depends(require_any_permission(["locations:write", "locations:manage"])),
```

### users.py — GET

```python
_user=Depends(require_any_permission(["users:read", "users:manage"])),
```

### integrations.py

```python
_user=Depends(require_permission("integrations:write")),
```

### dashboard.py

```python
_user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
```

---

## 5) Frontend

- `mobile-pwa/src/rbac/permissions.ts`: Role, PermissionKey, ROLE_PERMISSIONS (picker without receiving; controller with adjust/receiving/documents:write_status; admin all). hasPermission(role, permission) + aliases.
- `mobile-pwa/src/rbac/routes.ts`: getHomeRouteForRole(role) — picker → /picker, inventory_controller → /controller, else → /admin.
- `mobile-pwa/src/rbac/menuConfig.ts`: PICKER_MENU, CONTROLLER_MENU, ADMIN_MENU; getMenuForRole(role).
- Route guard: RequirePermission(permission), RequireRoleOrPermission(permission | permissions | roles).

---

## 6) Patch plan (qadam-baqadam)

1. **Backend permissions**  
   - `backend/app/auth/permissions.py`: yangi konstantlar, ROLE_PERMISSIONS (3 rol), LEGACY_EXPANSION, get_permissions_for_role.

2. **Backend deps + guards**  
   - `deps.py`: require_role.  
   - `auth/guards.py`: check_controller_adjust_reason, check_picker_move_zone_target.

3. **Backend endpoints**  
   - inventory: reason_code, adjust guard, fix-duplicate-pick → maintenance:write.  
   - locations: read vs write dependency.  
   - users: read vs manage.  
   - integrations: integrations:write.  
   - dashboard: reports:read | audit:read | admin:access.

4. **Frontend**  
   - permissions.ts: 3 rol, yangi PermissionKey, ROLE_PERMISSIONS.  
   - menuConfig.ts: PICKER_MENU, CONTROLLER_MENU, ADMIN_MENU, getMenuForRole.

5. **Test**  
   - Quyidagi 15 ta test.

---

## 7) Test checklist (15+)

| # | Test | Expected |
|---|------|----------|
| 1 | Picker POST /api/v1/receiving/receipts | 403 |
| 2 | Picker POST /api/v1/inventory/movements (adjust) | 403 |
| 3 | Picker PATCH /api/v1/documents/{id} (cancel) | 403 |
| 4 | Controller POST /api/v1/inventory/movements with reason_code=inventory_shortage | 201 |
| 5 | Controller POST /api/v1/inventory/movements (adjust) without reason_code | 400 (controller reason whitelist) |
| 6 | Controller POST /api/v1/inventory/movements (adjust) reason_code=other | 400 |
| 7 | Picker POST /api/v1/inventory/move-to-zone target_zone=QUARANTINE (when implemented) | 403 |
| 8 | Controller GET /api/v1/receiving/receipts | 200 |
| 9 | Controller POST /api/v1/receiving/receipts | 201 |
| 10 | Admin GET /api/v1/users | 200 |
| 11 | Admin POST /api/v1/users | 201 |
| 12 | Controller GET /api/v1/users | 403; Controller POST /api/v1/users | 403 |
| 13 | Admin POST /api/v1/integrations/smartup/import | 200/204 |
| 14 | Controller GET /api/v1/dashboard/summary | 200 |
| 15 | Picker GET /api/v1/inventory/picker | 200 |
| 16 | No token GET /api/v1/orders | 401 |
| 17 | Admin POST /api/v1/inventory/fix-duplicate-pick | 200; Controller same | 403 (maintenance:write) |

**Audit script tavsiya:** Barcha router fayllarida `@router.post`, `@router.put`, `@router.patch`, `@router.delete` da `Depends(require_permission(...))` yoki `Depends(require_any_permission(...))` yoki `Depends(get_current_user)` bor-yo‘qligini tekshiruvchi skript. Agar yo‘q bo‘lsa — FAIL.
