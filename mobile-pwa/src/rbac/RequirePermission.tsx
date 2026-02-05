import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from './AuthProvider'
import type { PermissionKey } from './permissions'

type RequirePermissionProps = {
  permission: PermissionKey
  children: ReactNode
}

export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const { has, user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return null
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (!has(permission)) {
    return <Navigate to="/admin/not-authorized" replace state={{ from: location }} />
  }

  return <>{children}</>
}
