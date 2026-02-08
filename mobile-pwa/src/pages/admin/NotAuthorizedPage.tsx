import { useNavigate } from 'react-router-dom'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { NotAuthorized } from '../../rbac/NotAuthorized'
import { useAuth } from '../../rbac/AuthProvider'
import { getHomeRouteForRole } from '../../rbac/routes'

export function NotAuthorizedPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const home = user ? getHomeRouteForRole(user.role) : '/login'
  const handleBack = () => {
    if (window.history.length <= 1) {
      navigate('/login', { replace: true })
      return
    }
    navigate(-1)
  }

  return (
    <AdminLayout title="Not authorized">
      <NotAuthorized onHome={() => navigate(home)} onBack={handleBack} />
    </AdminLayout>
  )
}
