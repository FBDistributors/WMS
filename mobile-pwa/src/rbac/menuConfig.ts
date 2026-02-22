/**
 * Menu structure for PICKER / CONTROLLER / ADMIN.
 * Each item requires at least one of the listed permissions.
 */
import type { PermissionKey } from './permissions'
import { hasPermission } from './permissions'
import type { Role } from './permissions'

export type MenuItem = {
  path: string
  labelKey: string
  permissions: PermissionKey[]
}

/** Picker: picking screens + inventory read + count + move-zone */
export const PICKER_MENU: MenuItem[] = [
  { path: '/picker', labelKey: 'menu.pickerHome', permissions: ['picking:read'] },
  { path: '/picking/mobile-pwa', labelKey: 'menu.pickList', permissions: ['picking:read'] },
  { path: '/picker/inventory', labelKey: 'menu.inventory', permissions: ['picking:read', 'inventory:read'] },
  { path: '/picker/profile', labelKey: 'menu.profile', permissions: ['picking:read'] },
  { path: '/picker/settings', labelKey: 'menu.settings', permissions: ['picking:read'] },
]

/** Controller: receiving + inventory approve/adjust + audit + reports */
export const CONTROLLER_MENU: MenuItem[] = [
  { path: '/controller', labelKey: 'menu.controllerHome', permissions: ['documents:read'] },
  { path: '/controller/documents', labelKey: 'menu.documents', permissions: ['documents:read'] },
  { path: '/controller/products', labelKey: 'menu.products', permissions: ['products:read'] },
  { path: '/admin/receiving', labelKey: 'menu.receiving', permissions: ['receiving:read'] },
  { path: '/admin/inventory', labelKey: 'menu.inventory', permissions: ['inventory:read'] },
  { path: '/admin/audit', labelKey: 'menu.audit', permissions: ['audit:read'] },
  { path: '/controller/profile', labelKey: 'menu.profile', permissions: ['documents:read'] },
  { path: '/controller/settings', labelKey: 'menu.settings', permissions: ['documents:read'] },
]

/** Admin: full menu (dashboard, orders, picking, locations, users, etc.) */
export const ADMIN_MENU: MenuItem[] = [
  { path: '/admin', labelKey: 'menu.dashboard', permissions: ['admin:access'] },
  { path: '/admin/orders', labelKey: 'menu.orders', permissions: ['orders:read'] },
  { path: '/admin/picking', labelKey: 'menu.picking', permissions: ['picking:read'] },
  { path: '/admin/inventory', labelKey: 'menu.inventory', permissions: ['inventory:read'] },
  { path: '/admin/inventory/movements', labelKey: 'menu.movements', permissions: ['movements:read'] },
  { path: '/admin/receiving', labelKey: 'menu.receiving', permissions: ['receiving:read'] },
  { path: '/admin/locations', labelKey: 'menu.locations', permissions: ['locations:read', 'locations:manage'] },
  { path: '/admin/products', labelKey: 'menu.products', permissions: ['products:read'] },
  { path: '/admin/brands', labelKey: 'menu.brands', permissions: ['brands:manage'] },
  { path: '/admin/users', labelKey: 'menu.users', permissions: ['users:read', 'users:manage'] },
  { path: '/admin/audit', labelKey: 'menu.audit', permissions: ['audit:read'] },
  { path: '/admin/profile', labelKey: 'menu.profile', permissions: ['admin:access'] },
]

export function getMenuForRole(role: Role): MenuItem[] {
  if (role === 'picker') return PICKER_MENU
  if (role === 'inventory_controller' || role === 'supervisor') return CONTROLLER_MENU
  return ADMIN_MENU
}

export function filterMenuByPermission(role: Role, items: MenuItem[]): MenuItem[] {
  return items.filter((item) =>
    item.permissions.some((perm) => hasPermission(role, perm))
  )
}
