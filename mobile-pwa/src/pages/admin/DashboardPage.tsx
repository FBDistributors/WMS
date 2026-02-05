import { Package, ClipboardList, CheckCircle2, AlertTriangle } from 'lucide-react'

import { AdminLayout } from '../../components/admin/AdminLayout'
import { Card } from '../../components/ui/card'

const stats = [
  {
    label: 'Total products',
    value: '—',
    icon: Package,
  },
  {
    label: 'Open pick lists',
    value: '—',
    icon: ClipboardList,
  },
  {
    label: 'Completed today',
    value: '—',
    icon: CheckCircle2,
  },
  {
    label: 'Exceptions',
    value: '—',
    icon: AlertTriangle,
  },
]

export function DashboardPage() {
  return (
    <AdminLayout title="Dashboard">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label} className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-500">{stat.label}</div>
                <div className="text-2xl font-semibold text-slate-900">{stat.value}</div>
              </div>
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-500">
                <Icon size={20} />
              </div>
            </Card>
          )
        })}
      </div>
    </AdminLayout>
  )
}
