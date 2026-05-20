import { MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import type { PickLine } from '../../services/pickingApi'
import { formatPickingSkipReason, lineStatusBadgeLabel } from '../../services/pickingApi'

type PickLineRowProps = {
  line: PickLine
  onClick?: () => void
}

const statusVariant: Record<PickLine['status'], 'neutral' | 'primary' | 'success' | 'danger'> =
  {
    NEW: 'neutral',
    IN_PROGRESS: 'primary',
    DONE: 'success',
    NOT_PICKED: 'danger',
    ERROR: 'danger',
  }

export function PickLineRow({ line, onClick }: PickLineRowProps) {
  const { t } = useTranslation('picking')
  const vipInfo = line.is_vip_expiry_informational === true
  const reasonText =
    !vipInfo && line.skip_reason?.trim()
      ? formatPickingSkipReason(line.skip_reason, t)
      : null
  return (
    <Card
      className={[
        'flex flex-col gap-2',
        vipInfo ? 'border-red-300 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/40' : '',
        !vipInfo && line.status === 'DONE' ? 'border-green-200 bg-green-50/60' : '',
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
        <Badge variant={statusVariant[line.status]}>{lineStatusBadgeLabel(line, t)}</Badge>
      </div>
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <MapPin size={14} />
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">
          {line.location_code}
        </span>
      </div>
      {vipInfo ? (
        <p className="text-sm text-red-800 dark:text-red-200">{t('vip_expiry_not_picked')}</p>
      ) : null}
      {reasonText ? (
        <p className="text-sm text-amber-800 dark:text-amber-200">
          {t('line_skip_reason', { reason: reasonText })}
        </p>
      ) : line.status === 'NOT_PICKED' ? (
        <p className="text-sm text-amber-800 dark:text-amber-200">{t('line_not_picked_hint')}</p>
      ) : null}
      <div className="flex items-center justify-between text-sm text-slate-700">
        <span>{t('qty')}</span>
        <span className="font-semibold">
          {line.qty_picked}/{line.qty_required}
        </span>
      </div>
    </Card>
  )
}
