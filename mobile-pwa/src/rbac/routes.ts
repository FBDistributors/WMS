import type { Role } from './permissions'

export function getHomeRouteForRole(role: Role) {
  if (role === 'picker') {
    return '/picking/mobile-pwa'
  }
  return '/admin'
}
