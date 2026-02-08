import { useLocation, useNavigate } from 'react-router-dom'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { NotAuthorized } from '../../rbac/NotAuthorized'
import { useAuth } from '../../rbac/AuthProvider'
import { getHomeRouteForRole } from '../../rbac/routes'
import { clearToken } from '../../services/authApi'

export function NotAuthorizedPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const home = user ? getHomeRouteForRole(user.role) : '/login'
  const handleBack = () => {
    const from = (location.state as { from?: Location })?.from?.pathname
    if (from && from !== location.pathname && from !== '/admin/not-authorized') {
      navigate(from, { replace: true })
      return
    }
    window.location.assign('/login')
  }

  return (
    <AdminLayout title="Not authorized">
      <NotAuthorized
        onHome={() => navigate(home)}
        onBack={handleBack}
        onLogin={() => {
          clearToken()
          window.location.assign('/login')
        }}
      />
    </AdminLayout>
  )
}
