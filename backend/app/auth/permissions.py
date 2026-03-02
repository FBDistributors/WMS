"""
RBAC: 3 roles (picker, controller, admin). Backend is single source of truth.
Legacy permission names are expanded from new names so existing endpoint code works.
"""
from __future__ import annotations

# -----------------------------------------------------------------------------
# Permission constants (new standard names)
# -----------------------------------------------------------------------------
# Auth: login/me are open or JWT-only; no permission needed
# Picking
PERM_PICKING_READ = "picking:read"
PERM_PICKING_WRITE = "picking:write"
# Inventory
PERM_INVENTORY_READ = "inventory:read"
PERM_INVENTORY_COUNT = "inventory:count"
PERM_INVENTORY_ADJUST = "inventory:adjust"
PERM_INVENTORY_MOVE_ZONE = "inventory:move_zone"
# Receiving
PERM_RECEIVING_READ = "receiving:read"
PERM_RECEIVING_WRITE = "receiving:write"
# Documents
PERM_DOCUMENTS_READ = "documents:read"
PERM_DOCUMENTS_WRITE_STATUS = "documents:write_status"
PERM_DOCUMENTS_CREATE = "documents:create"
# Orders
PERM_ORDERS_READ = "orders:read"
PERM_ORDERS_WRITE = "orders:write"
# Products
PERM_PRODUCTS_READ = "products:read"
PERM_PRODUCTS_WRITE = "products:write"
# Locations
PERM_LOCATIONS_READ = "locations:read"
PERM_LOCATIONS_WRITE = "locations:write"
# Users
PERM_USERS_READ = "users:read"
PERM_USERS_WRITE = "users:write"
# Audit & reports
PERM_AUDIT_READ = "audit:read"
PERM_REPORTS_READ = "reports:read"
# Integrations & maintenance
PERM_INTEGRATIONS_WRITE = "integrations:write"
PERM_MAINTENANCE_WRITE = "maintenance:write"
# Movements (read)
PERM_MOVEMENTS_READ = "movements:read"
# Brands
PERM_BRANDS_MANAGE = "brands:manage"
# Waves
PERM_WAVES_READ = "waves:read"
PERM_WAVES_CREATE = "waves:create"
PERM_WAVES_MANAGE = "waves:manage"
PERM_WAVES_PICK = "waves:pick"
PERM_WAVES_SORT = "waves:sort"

# All permissions set (includes legacy names used in endpoints)
PERMISSIONS: set[str] = {
    PERM_PICKING_READ,
    PERM_PICKING_WRITE,
    PERM_INVENTORY_READ,
    PERM_INVENTORY_COUNT,
    PERM_INVENTORY_ADJUST,
    PERM_INVENTORY_MOVE_ZONE,
    PERM_RECEIVING_READ,
    PERM_RECEIVING_WRITE,
    PERM_DOCUMENTS_READ,
    PERM_DOCUMENTS_WRITE_STATUS,
    PERM_DOCUMENTS_CREATE,
    PERM_ORDERS_READ,
    PERM_ORDERS_WRITE,
    PERM_PRODUCTS_READ,
    PERM_PRODUCTS_WRITE,
    PERM_LOCATIONS_READ,
    PERM_LOCATIONS_WRITE,
    PERM_USERS_READ,
    PERM_USERS_WRITE,
    PERM_AUDIT_READ,
    PERM_REPORTS_READ,
    PERM_INTEGRATIONS_WRITE,
    PERM_MAINTENANCE_WRITE,
    PERM_MOVEMENTS_READ,
    PERM_BRANDS_MANAGE,
    PERM_WAVES_READ,
    PERM_WAVES_CREATE,
    PERM_WAVES_MANAGE,
    PERM_WAVES_PICK,
    PERM_WAVES_SORT,
    # Legacy names (still used in endpoint Depends; granted via expansion)
    "admin:access",
    "users:manage",
    "roles:manage",
    "orders:sync",
    "orders:send_to_picking",
    "picking:assign",
    "picking:pick",
    "picking:complete",
    "picking:exception",
    "picking:send_to_controller",
    "documents:edit_status",
    "locations:manage",
}

# New permission -> legacy names that this permission implies (for endpoint compat)
LEGACY_EXPANSION: dict[str, list[str]] = {
    PERM_DOCUMENTS_WRITE_STATUS: ["documents:edit_status"],
    PERM_ORDERS_WRITE: ["orders:sync", "orders:send_to_picking", "picking:assign"],
    PERM_PICKING_WRITE: [
        "picking:pick",
        "picking:complete",
        "picking:exception",
        "picking:send_to_controller",
    ],
    PERM_LOCATIONS_WRITE: ["locations:manage"],
    PERM_USERS_WRITE: ["users:manage"],
    # Admin gets admin:access for dashboard/brands etc.; we grant all perms explicitly so no single "admin:access"
}

# -----------------------------------------------------------------------------
# Role -> permissions (only new-style names; legacy added in get_permissions_for_role)
# PICKER / CONTROLLER / ADMIN (warehouse_admin)
# -----------------------------------------------------------------------------
ROLE_PERMISSIONS: dict[str, list[str]] = {
    "picker": [
        PERM_PICKING_READ,
        PERM_PICKING_WRITE,
        PERM_INVENTORY_READ,
        PERM_INVENTORY_COUNT,
        PERM_INVENTORY_MOVE_ZONE,
        PERM_DOCUMENTS_READ,
        PERM_REPORTS_READ,
        PERM_PRODUCTS_READ,
        PERM_WAVES_READ,
        PERM_WAVES_PICK,
    ],
    "inventory_controller": [
        PERM_PICKING_READ,
        PERM_PICKING_WRITE,
        PERM_INVENTORY_READ,
        PERM_INVENTORY_COUNT,
        PERM_INVENTORY_ADJUST,
        PERM_INVENTORY_MOVE_ZONE,
        PERM_RECEIVING_READ,
        PERM_RECEIVING_WRITE,
        PERM_DOCUMENTS_READ,
        PERM_DOCUMENTS_WRITE_STATUS,
        PERM_ORDERS_READ,
        PERM_ORDERS_WRITE,
        PERM_AUDIT_READ,
        PERM_REPORTS_READ,
        PERM_PRODUCTS_READ,
        PERM_LOCATIONS_READ,
        PERM_MOVEMENTS_READ,
    ],
    "warehouse_admin": [
        PERM_PICKING_READ,
        PERM_PICKING_WRITE,
        PERM_INVENTORY_READ,
        PERM_INVENTORY_COUNT,
        PERM_INVENTORY_ADJUST,
        PERM_INVENTORY_MOVE_ZONE,
        PERM_RECEIVING_READ,
        PERM_RECEIVING_WRITE,
        PERM_DOCUMENTS_READ,
        PERM_DOCUMENTS_WRITE_STATUS,
        PERM_DOCUMENTS_CREATE,
        PERM_ORDERS_READ,
        PERM_ORDERS_WRITE,
        PERM_PRODUCTS_READ,
        PERM_PRODUCTS_WRITE,
        PERM_LOCATIONS_READ,
        PERM_LOCATIONS_WRITE,
        PERM_USERS_READ,
        PERM_USERS_WRITE,
        PERM_AUDIT_READ,
        PERM_REPORTS_READ,
        PERM_INTEGRATIONS_WRITE,
        PERM_MAINTENANCE_WRITE,
        PERM_MOVEMENTS_READ,
        PERM_BRANDS_MANAGE,
        PERM_WAVES_READ,
        PERM_WAVES_CREATE,
        PERM_WAVES_MANAGE,
        PERM_WAVES_PICK,
        PERM_WAVES_SORT,
        "admin:access",
    ],
    # Backward compat: supervisor = controller; receiver = receiving only
    "supervisor": [
        PERM_PICKING_READ,
        PERM_PICKING_WRITE,
        PERM_INVENTORY_READ,
        PERM_INVENTORY_COUNT,
        PERM_INVENTORY_ADJUST,
        PERM_INVENTORY_MOVE_ZONE,
        PERM_RECEIVING_READ,
        PERM_RECEIVING_WRITE,
        PERM_DOCUMENTS_READ,
        PERM_DOCUMENTS_WRITE_STATUS,
        PERM_ORDERS_READ,
        PERM_ORDERS_WRITE,
        PERM_AUDIT_READ,
        PERM_REPORTS_READ,
        PERM_PRODUCTS_READ,
        PERM_LOCATIONS_READ,
        PERM_MOVEMENTS_READ,
        PERM_BRANDS_MANAGE,
        "admin:access",
    ],
    "receiver": [
        PERM_RECEIVING_READ,
        PERM_RECEIVING_WRITE,
        PERM_DOCUMENTS_READ,
        PERM_PRODUCTS_READ,
        "admin:access",
    ],
}


def get_permissions_for_role(role: str) -> list[str]:
    """Return list of permissions for role, including legacy expansion for endpoint compat."""
    base = list(ROLE_PERMISSIONS.get(role, []))
    result = set(base)
    for perm in base:
        for legacy in LEGACY_EXPANSION.get(perm, []):
            result.add(legacy)
    return list(result)


def has_permission(role: str, permission: str) -> bool:
    return permission in get_permissions_for_role(role)
