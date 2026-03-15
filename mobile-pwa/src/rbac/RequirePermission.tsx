import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { PageSpinner } from '../components/ui/PageSpinner'
import { useAuth } from './AuthProvider'
import type { PermissionKey } from './permissions'

type RequirePermissionProps = {
  permission: PermissionKey
  redirectTo?: string
  children: ReactNode
}

export function RequirePermission({ permission, redirectTo, children }: RequirePermissionProps) {
  const { has, user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <PageSpinner />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (!has(permission)) {
    return (
      <Navigate
        to={redirectTo ?? '/admin/not-authorized'}
        replace
        state={{ from: location }}
      />
    )
  }

  return <>{children}</>
}
