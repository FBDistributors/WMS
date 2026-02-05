import { Package, ClipboardList, CheckCircle2, AlertTriangle } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Card } from '../../components/ui/card'
import { Separator } from '../../components/ui/separator'

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

      <div className="mt-6">
        <Card>
          <div className="text-base font-semibold text-slate-900">Recent activity</div>
          <Separator className="my-3" />
          <ul className="space-y-3 text-sm text-slate-600">
            <li>SO-0001 created · 5 mins ago</li>
            <li>Pick list SO-0002 completed · 12 mins ago</li>
            <li>Inventory adjusted · 30 mins ago</li>
          </ul>
        </Card>
      </div>
    </AdminLayout>
  )
}
