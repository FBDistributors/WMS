import type { Role } from './permissions'

export function getHomeRouteForRole(role: Role) {
  if (role === 'picker') {
    return '/picker'
  }
  return '/admin'
}
