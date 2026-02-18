import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

import { Card } from '../../components/ui/card'

type KpiCardProps = {
  title: string
  value: string | number
  delta?: string
  icon: LucideIcon
  href: string
}

export function KpiCard({ title, value, delta, icon: Icon, href }: KpiCardProps) {
  return (
    <Link to={href} className="block h-full">
      <Card className="flex h-full min-h-[100px] items-center justify-between hover:border-blue-200">
        <div>
          <div className="text-sm text-slate-500">{title}</div>
          <div className="text-2xl font-semibold text-slate-900">{value}</div>
          {delta ? <div className="text-xs text-slate-500">{delta}</div> : null}
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-500">
          <Icon size={20} />
        </div>
      </Card>
    </Link>
  )
}
