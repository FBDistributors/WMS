import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

import { Card } from '../../components/ui/card'

type KpiCardProps = {
  title: string
  value: string | number
  delta?: string
  icon: LucideIcon
  /** If not provided or empty, card is info-only (not clickable). */
  href?: string
}

export function KpiCard({ title, value, delta, icon: Icon, href }: KpiCardProps) {
  const card = (
    <Card
      className={`flex h-full min-h-[100px] items-center justify-between ${href ? 'hover:border-blue-200 dark:hover:border-blue-800' : ''}`}
    >
      <div>
        <div className="text-sm text-slate-500 dark:text-slate-400">{title}</div>
        <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</div>
        {delta ? <div className="text-xs text-slate-500 dark:text-slate-400">{delta}</div> : null}
      </div>
      <div className="rounded-2xl bg-slate-100 p-3 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <Icon size={20} />
      </div>
    </Card>
  )
  if (href) {
    return (
      <Link to={href} className="block h-full">
        {card}
      </Link>
    )
  }
  return <div className="block h-full">{card}</div>
}
