export type Role =
  | 'warehouse_admin'
  | 'supervisor'
  | 'picker'
  | 'receiver'
  | 'inventory_controller'

export type PermissionKey =
  | 'admin:access'
  | 'users:manage'
  | 'roles:manage'
  | 'audit:read'
  | 'reports:read'
  | 'products:read'
  | 'products:write'
  | 'orders:read'
  | 'orders:sync'
  | 'orders:send_to_picking'
  | 'picking:assign'
  | 'documents:read'
  | 'documents:create'
  | 'documents:edit_status'
  | 'receiving:read'
  | 'receiving:write'
  | 'picking:read'
  | 'picking:pick'
  | 'picking:complete'
  | 'picking:exception'
  | 'inventory:read'
  | 'inventory:count'
  | 'inventory:adjust'
  | 'locations:manage'
  | 'movements:read'
  | 'brands:manage'

export const PERMISSION_KEYS: PermissionKey[] = [
  'admin:access',
  'users:manage',
  'roles:manage',
  'audit:read',
  'reports:read',
  'products:read',
  'products:write',
  'orders:read',
  'orders:sync',
  'orders:send_to_picking',
  'picking:assign',
  'documents:read',
  'documents:create',
  'documents:edit_status',
  'receiving:read',
  'receiving:write',
  'picking:read',
  'picking:pick',
  'picking:complete',
  'picking:exception',
  'inventory:read',
  'inventory:count',
  'inventory:adjust',
  'locations:manage',
  'movements:read',
  'brands:manage',
]

const PERMISSION_ALIASES: Record<string, PermissionKey> = {
  'admin:access': 'documents:read',
  'picking:write': 'picking:pick',
  'inventory:write': 'inventory:adjust',
}

export const ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  warehouse_admin: [
    'admin:access',
    'users:manage',
    'roles:manage',
    'products:read',
    'products:write',
    'orders:read',
    'orders:sync',
    'orders:send_to_picking',
    'picking:assign',
    'documents:read',
    'documents:create',
    'documents:edit_status',
    'receiving:read',
    'receiving:write',
    'picking:read',
    'picking:pick',
    'picking:complete',
    'picking:exception',
    'inventory:read',
    'inventory:count',
    'inventory:adjust',
    'locations:manage',
    'movements:read',
    'brands:manage',
    'reports:read',
    'audit:read',
  ],
  supervisor: [
    'admin:access',
    'products:read',
    'products:write',
    'orders:read',
    'orders:sync',
    'orders:send_to_picking',
    'picking:assign',
    'documents:read',
    'documents:edit_status',
    'receiving:read',
    'receiving:write',
    'picking:read',
    'picking:pick',
    'picking:complete',
    'picking:exception',
    'inventory:read',
    'inventory:count',
    'reports:read',
    'locations:manage',
    'movements:read',
    'brands:manage',
  ],
  picker: ['picking:read', 'picking:pick', 'picking:complete', 'picking:exception'],
  receiver: [
    'admin:access',
    'receiving:read',
    'receiving:write',
    'documents:read',
    'products:read',
  ],
  inventory_controller: [
    'admin:access',
    'documents:read',
    'products:read',
    'picking:read',
    'inventory:read',
  ],
}

export function normalizePermissions(permissions: string[]): PermissionKey[] {
  return permissions
    .map((key) => PERMISSION_ALIASES[key] ?? key)
    .filter((key): key is PermissionKey => PERMISSION_KEYS.includes(key as PermissionKey))
}

export function hasPermission(role: Role, permission: PermissionKey) {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export function isWarehouseAdmin(role: Role) {
  return role === 'warehouse_admin'
}

export function isSupervisor(role: Role) {
  return role === 'supervisor'
}

export function isPicker(role: Role) {
  return role === 'picker'
}

export function isReceiver(role: Role) {
  return role === 'receiver'
}

export function isInventoryController(role: Role) {
  return role === 'inventory_controller'
}
