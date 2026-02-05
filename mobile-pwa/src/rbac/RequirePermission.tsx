import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from './AuthProvider'
import type { PermissionKey } from './permissions'

type RequirePermissionProps = {
  permission: PermissionKey
  children: ReactNode
}

export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const { has } = useAuth()
  const location = useLocation()

  if (!has(permission)) {
    return <Navigate to="/admin/not-authorized" replace state={{ from: location }} />
  }

  return <>{children}</>
}
