import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '../../auth/AuthContext'
import type { PermissionKey } from '../../auth/permissions'
import { NotAuthorizedPage } from '../../pages/admin/NotAuthorizedPage'

type AdminRouteProps = {
  permission: PermissionKey
  children: ReactNode
}

export function AdminRoute({ permission, children }: AdminRouteProps) {
  const { hasPermission } = useAuth()

  if (!hasPermission('admin:read')) {
    return <Navigate to="/picking/mobile-pwa" replace />
  }

  if (!hasPermission(permission)) {
    return <NotAuthorizedPage />
  }

  return <>{children}</>
}
