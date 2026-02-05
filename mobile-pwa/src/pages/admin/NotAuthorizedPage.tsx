import { ShieldAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { AdminLayout } from '../../components/admin/AdminLayout'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/EmptyState'

export function NotAuthorizedPage() {
  const navigate = useNavigate()

  return (
    <AdminLayout title="Not authorized">
      <EmptyState
        icon={<ShieldAlert size={32} />}
        title="Ruxsat yo‘q"
        description="Bu sahifani ko‘rish uchun ruxsatingiz yetarli emas."
        actionLabel="Pick listga qaytish"
        onAction={() => navigate('/picking/mobile-pwa')}
      />
      <div className="mt-4 flex justify-center">
        <Button variant="outline" onClick={() => navigate(-1)}>
          Orqaga
        </Button>
      </div>
    </AdminLayout>
  )
}
