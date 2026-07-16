import { CalendarDays, ClipboardList, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import type { PickList } from '../../services/pickingApi'

const statusVariant: Record<PickList['status'], 'neutral' | 'primary' | 'success' | 'danger'> = {
  NEW: 'neutral',
  IN_PROGRESS: 'primary',
  REVIEW: 'primary',
  DONE: 'success',
  ERROR: 'danger',
  UNKNOWN: 'neutral',
}

type PickListCardProps = {
  item: PickList
  onClick?: () => void
}

export function PickListCard({ item, onClick }: PickListCardProps) {
  const { t } = useTranslation('picking')
  const progressText = `${item.picked_lines}/${item.total_lines}`
  const statusKey = item.status.toLowerCase() as 'new' | 'in_progress' | 'review' | 'done' | 'error' | 'unknown'

  return (
    <Card
      className="cursor-pointer transition hover:border-blue-200"
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="text-sm text-slate-500">{t('document_label')}</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {item.order_number
              ? t('order_number_display', { number: item.order_number })
              : item.document_no}
          </div>
          {item.delivery_number ? (
            <div className="text-sm text-slate-600 dark:text-slate-400">
              {t('delivery_number_short', { number: item.delivery_number })}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <CalendarDays size={14} />
            <span>{item.created_at ?? '—'}</span>
            <span className="mx-1">•</span>
            <ClipboardList size={14} />
            <span>{progressText} {t('total_lines')}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant[item.status]}>
            {t(`status.${statusKey}`)}
          </Badge>
          <ChevronRight size={18} className="text-slate-400" />
        </div>
      </div>
    </Card>
  )
}
