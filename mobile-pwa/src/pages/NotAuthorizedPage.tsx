import { useNavigate } from 'react-router-dom'

import { NotAuthorized } from '../rbac/NotAuthorized'
import { useAuth } from '../rbac/AuthProvider'
import { getHomeRouteForRole } from '../rbac/routes'

export function NotAuthorizedPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const home = user ? getHomeRouteForRole(user.role) : '/login'

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <NotAuthorized onHome={() => navigate(home)} onBack={() => navigate(-1)} />
    </div>
  )
}
