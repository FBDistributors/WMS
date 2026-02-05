import { AdminLayout } from '../../admin/components/AdminLayout'
import { EmptyState } from '../../components/ui/EmptyState'
import { Users } from 'lucide-react'

export function UsersPage() {
  return (
    <AdminLayout title="Users & Access">
      <EmptyState
        icon={<Users size={32} />}
        title="Users module coming soon"
        description="Bu bo‘lim keyingi bosqichda qo‘shiladi."
      />
    </AdminLayout>
  )
}
