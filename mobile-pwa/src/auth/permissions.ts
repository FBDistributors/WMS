export type Role = 'admin' | 'manager' | 'picker'

export type PermissionKey =
  | 'admin:read'
  | 'products:read'
  | 'products:write'
  | 'inventory:read'
  | 'users:manage'
  | 'picking:read'

export const ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  admin: [
    'admin:read',
    'products:read',
    'products:write',
    'inventory:read',
    'users:manage',
    'picking:read',
  ],
  manager: ['admin:read', 'products:read', 'inventory:read', 'picking:read'],
  picker: ['picking:read'],
}
