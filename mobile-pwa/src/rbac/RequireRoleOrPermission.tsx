import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from './AuthProvider'
import type { PermissionKey, Role } from './permissions'

type RequireRoleOrPermissionProps = {
  roles?: Role[]
  permission?: PermissionKey
  permissions?: PermissionKey[]
  redirectTo?: string
  children: ReactNode
}

export function RequireRoleOrPermission({
  roles,
  permission,
  permissions,
  redirectTo,
  children,
}: RequireRoleOrPermissionProps) {
  const { user, isLoading, has } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return null
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  const hasRole = roles ? roles.includes(user.role) : false
  const hasPermission = permission ? has(permission) : false
  const hasAnyPermission = permissions ? permissions.some((key) => has(key)) : false
  const isAllowed = hasRole || hasPermission || hasAnyPermission

  if (!isAllowed) {
    return <Navigate to={redirectTo ?? '/not-authorized'} replace state={{ from: location }} />
  }

  return <>{children}</>
}
