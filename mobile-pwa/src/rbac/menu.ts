import type { LucideIcon } from 'lucide-react'

import type { PermissionKey } from './permissions'

export type MenuItem = {
  label: string
  path: string
  icon: LucideIcon
  required?: PermissionKey
}

export function filterMenuByPermissions(
  items: MenuItem[],
  permissions: PermissionKey[]
) {
  return items.filter((item) => !item.required || permissions.includes(item.required))
}
