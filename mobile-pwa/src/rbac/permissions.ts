/**
 * RBAC: 3 main roles (picker, controller, admin). Must match backend permissions.py.
 * Frontend guard is secondary; backend is source of truth.
 */
export type Role =
  | 'picker'
  | 'inventory_controller'
  | 'warehouse_admin'
  | 'supervisor'
  | 'receiver'

export type PermissionKey =
  | 'picking:read'
  | 'picking:write'
  | 'inventory:read'
  | 'inventory:count'
  | 'inventory:adjust'
  | 'inventory:move_zone'
  | 'receiving:read'
  | 'receiving:write'
  | 'documents:read'
  | 'documents:write_status'
  | 'documents:create'
  | 'orders:read'
  | 'orders:write'
  | 'products:read'
  | 'products:write'
  | 'locations:read'
  | 'locations:write'
  | 'users:read'
  | 'users:write'
  | 'audit:read'
  | 'reports:read'
  | 'integrations:write'
  | 'maintenance:write'
  | 'movements:read'
  | 'brands:manage'
  | 'admin:access'
  | 'waves:read'
  | 'waves:pick'
  | 'waves:create'
  | 'waves:manage'
  | 'waves:sort'
  // Legacy (backend expands from new names)
  | 'documents:edit_status'
  | 'users:manage'
  | 'locations:manage'

export const PERMISSION_KEYS: PermissionKey[] = [
  'picking:read',
  'picking:write',
  'inventory:read',
  'inventory:count',
  'inventory:adjust',
  'inventory:move_zone',
  'receiving:read',
  'receiving:write',
  'documents:read',
  'documents:write_status',
  'documents:create',
  'orders:read',
  'orders:write',
  'products:read',
  'products:write',
  'locations:read',
  'locations:write',
  'users:read',
  'users:write',
  'audit:read',
  'reports:read',
  'integrations:write',
  'maintenance:write',
  'movements:read',
  'brands:manage',
  'admin:access',
  'waves:read',
  'waves:pick',
  'waves:create',
  'waves:manage',
  'waves:sort',
  'documents:edit_status',
  'users:manage',
  'locations:manage',
]

/** New permission -> legacy names (for UI checks that still use old names) */
const PERMISSION_ALIASES: Record<string, PermissionKey[]> = {
  'documents:write_status': ['documents:edit_status'],
  'orders:write': ['orders:read'],
  'locations:write': ['locations:manage'],
  'users:write': ['users:manage'],
}

/** Role -> permissions (new-style; aliases resolved in hasPermission) */
export const ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  picker: [
    'picking:read',
    'picking:write',
    'inventory:read',
    'inventory:count',
    'inventory:move_zone',
    'documents:read',
    'reports:read',
    'products:read',
    'waves:read',
    'waves:pick',
  ],
  inventory_controller: [
    'picking:read',
    'picking:write',
    'inventory:read',
    'inventory:count',
    'inventory:adjust',
    'inventory:move_zone',
    'receiving:read',
    'receiving:write',
    'documents:read',
    'documents:write_status',
    'orders:read',
    'orders:write',
    'audit:read',
    'reports:read',
    'products:read',
    'locations:read',
    'movements:read',
  ],
  warehouse_admin: [
    'picking:read',
    'picking:write',
    'inventory:read',
    'inventory:count',
    'inventory:adjust',
    'inventory:move_zone',
    'receiving:read',
    'receiving:write',
    'documents:read',
    'documents:write_status',
    'documents:create',
    'orders:read',
    'orders:write',
    'products:read',
    'products:write',
    'locations:read',
    'locations:write',
    'users:read',
    'users:write',
    'audit:read',
    'reports:read',
    'integrations:write',
    'maintenance:write',
    'movements:read',
    'brands:manage',
    'admin:access',
    'waves:read',
    'waves:pick',
    'waves:create',
    'waves:manage',
    'waves:sort',
    'documents:edit_status',
    'users:manage',
    'locations:manage',
  ],
  supervisor: [
    'picking:read',
    'picking:write',
    'inventory:read',
    'inventory:count',
    'inventory:adjust',
    'inventory:move_zone',
    'receiving:read',
    'receiving:write',
    'documents:read',
    'documents:write_status',
    'orders:read',
    'orders:write',
    'audit:read',
    'reports:read',
    'products:read',
    'locations:read',
    'movements:read',
    'brands:manage',
    'admin:access',
  ],
  receiver: [
    'receiving:read',
    'receiving:write',
    'documents:read',
    'products:read',
    'admin:access',
  ],
}

export function normalizePermissions(permissions: string[]): PermissionKey[] {
  return permissions.filter((key): key is PermissionKey =>
    PERMISSION_KEYS.includes(key as PermissionKey)
  )
}

export function hasPermission(role: Role, permission: PermissionKey): boolean {
  const direct = ROLE_PERMISSIONS[role]?.includes(permission) ?? false
  if (direct) return true
  for (const perm of ROLE_PERMISSIONS[role] ?? []) {
    const aliases = PERMISSION_ALIASES[perm]
    if (aliases?.includes(permission)) return true
  }
  return false
}

export function isPicker(role: Role) {
  return role === 'picker'
}

export function isInventoryController(role: Role) {
  return role === 'inventory_controller'
}

export function isWarehouseAdmin(role: Role) {
  return role === 'warehouse_admin'
}

export function isSupervisor(role: Role) {
  return role === 'supervisor'
}

export function isReceiver(role: Role) {
  return role === 'receiver'
}

/** Route permission required to access admin area (dashboard and below) */
export const ADMIN_AREA_PERMISSION: PermissionKey = 'admin:access'

/** Permissions that imply "can see admin dashboard" (controller sees reports/audit) */
export const DASHBOARD_PERMISSIONS: PermissionKey[] = [
  'admin:access',
  'reports:read',
  'audit:read',
]
