import { CalendarDays, ClipboardList, ChevronRight } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import type { PickList } from '../../services/pickingApi'

const statusLabel: Record<PickList['status'], string> = {
  NEW: 'New',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  ERROR: 'Error',
}

const statusVariant: Record<PickList['status'], 'neutral' | 'primary' | 'success' | 'danger'> =
  {
    NEW: 'neutral',
    IN_PROGRESS: 'primary',
    DONE: 'success',
    ERROR: 'danger',
  }

type PickListCardProps = {
  item: PickList
  onClick?: () => void
}

export function PickListCard({ item, onClick }: PickListCardProps) {
  const progressText = `${item.picked_lines}/${item.total_lines}`

  return (
    <Card
      className="cursor-pointer transition hover:border-blue-200"
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="text-sm text-slate-500">Document №</div>
          <div className="text-lg font-semibold text-slate-900">{item.document_no}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <CalendarDays size={14} />
            <span>{item.created_at ?? '—'}</span>
            <span className="mx-1">•</span>
            <ClipboardList size={14} />
            <span>{progressText} lines</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant[item.status]}>{statusLabel[item.status]}</Badge>
          <ChevronRight size={18} className="text-slate-400" />
        </div>
      </div>
    </Card>
  )
}
