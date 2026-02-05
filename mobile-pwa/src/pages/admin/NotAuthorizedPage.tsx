import { useNavigate } from 'react-router-dom'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { NotAuthorized } from '../../rbac/NotAuthorized'

export function NotAuthorizedPage() {
  const navigate = useNavigate()

  return (
    <AdminLayout title="Not authorized">
      <NotAuthorized onHome={() => navigate('/picking/mobile-pwa')} onBack={() => navigate(-1)} />
    </AdminLayout>
  )
}
