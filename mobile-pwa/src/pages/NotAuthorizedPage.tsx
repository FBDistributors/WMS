import { useLocation, useNavigate } from 'react-router-dom'

import { NotAuthorized } from '../rbac/NotAuthorized'
import { useAuth } from '../rbac/AuthProvider'
import { getHomeRouteForRole } from '../rbac/routes'

export function NotAuthorizedPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const home = user ? getHomeRouteForRole(user.role) : '/login'
  const handleBack = () => {
    const from = (location.state as { from?: Location })?.from?.pathname
    if (from && from !== location.pathname && from !== '/not-authorized') {
      navigate(from, { replace: true })
      return
    }
    window.location.assign('/login')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <NotAuthorized onHome={() => navigate(home)} onBack={handleBack} />
    </div>
  )
}
