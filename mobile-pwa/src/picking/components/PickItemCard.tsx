import { Badge } from '../../components/ui/badge'
import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/card'
import type { PickLineStatus } from '../../services/pickingApi'

type PickItemCardProps = {
  productName: string
  locationCode: string
  batch?: string | null
  expiryDate?: string | null
  qtyPicked: number
  qtyRequired: number
  status: PickLineStatus
}

export function PickItemCard({
  productName,
  locationCode,
  batch,
  expiryDate,
  qtyPicked,
  qtyRequired,
  status,
}: PickItemCardProps) {
  const { t } = useTranslation('picking')
  const statusVariant: Record<PickLineStatus, 'neutral' | 'primary' | 'success' | 'danger'> = {
    NEW: 'neutral',
    IN_PROGRESS: 'primary',
    DONE: 'success',
    ERROR: 'danger',
  }

  return (
    <Card className="p-5">
      <div className="text-xs uppercase text-slate-500">{t('product_label')}</div>
      <div className="text-2xl font-semibold text-slate-900">{productName}</div>
      <div className="mt-4 rounded-2xl bg-slate-100 p-6 text-center">
        <div className="text-xs uppercase text-slate-500">{t('location_label')}</div>
        <div className="text-5xl font-bold tracking-widest text-slate-900">
          {locationCode}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-600">
        <div>
          <div className="text-xs uppercase text-slate-500">{t('batch_label')}</div>
          <div className="font-semibold text-slate-900">{batch || '—'}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-slate-500">{t('expiry_label')}</div>
          <div className="font-semibold text-slate-900">{expiryDate || '—'}</div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <div>{t('picked_progress', { picked: qtyPicked, required: qtyRequired })}</div>
        <Badge variant={statusVariant[status]}>{t(`status.${status.toLowerCase()}`)}</Badge>
      </div>
    </Card>
  )
}
