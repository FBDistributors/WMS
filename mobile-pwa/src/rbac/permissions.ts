export type Role = 'admin' | 'manager' | 'picker'

export type PermissionKey =
  | 'admin:access'
  | 'products:read'
  | 'products:write'
  | 'inventory:read'
  | 'inventory:write'
  | 'picking:read'
  | 'picking:write'
  | 'users:manage'

export const ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  admin: [
    'admin:access',
    'products:read',
    'products:write',
    'inventory:read',
    'inventory:write',
    'picking:read',
    'picking:write',
    'users:manage',
  ],
  manager: ['admin:access', 'products:read', 'inventory:read', 'picking:read'],
  picker: ['picking:read', 'picking:write'],
}

export function hasPermission(role: Role, permission: PermissionKey) {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}
