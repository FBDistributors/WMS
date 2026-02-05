import { MapPin } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import type { PickLine } from '../../services/pickingApi'

type PickLineRowProps = {
  line: PickLine
  onClick?: () => void
}

const statusVariant: Record<PickLine['status'], 'neutral' | 'primary' | 'success' | 'danger'> =
  {
    NEW: 'neutral',
    IN_PROGRESS: 'primary',
    DONE: 'success',
    ERROR: 'danger',
  }

export function PickLineRow({ line, onClick }: PickLineRowProps) {
  return (
    <Card
      className={[
        'flex flex-col gap-2',
        line.status === 'DONE' ? 'border-green-200 bg-green-50/60' : '',
        line.status === 'ERROR' ? 'border-red-200 bg-red-50/60' : '',
      ].join(' ')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-900">{line.product_name}</div>
        </div>
        <Badge variant={statusVariant[line.status]}>{line.status}</Badge>
      </div>
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <MapPin size={14} />
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">
          {line.location_code}
        </span>
      </div>
      <div className="flex items-center justify-between text-sm text-slate-700">
        <span>Qty</span>
        <span className="font-semibold">
          {line.qty_picked}/{line.qty_required}
        </span>
      </div>
    </Card>
  )
}
