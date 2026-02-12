import type { Role } from './permissions'

export function getHomeRouteForRole(role: Role) {
  if (role === 'picker') {
    return '/picker'
  }
  if (role === 'inventory_controller') {
    return '/controller'
  }
  return '/admin'
}
