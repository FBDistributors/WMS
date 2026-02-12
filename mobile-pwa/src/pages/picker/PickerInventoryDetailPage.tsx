import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Boxes } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getPickerProductDetail, type PickerProductDetailResponse } from '../../services/pickerInventoryApi'
import { getExpiryColorClass } from '../../utils/expiry'

function formatExpiry(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString()
  } catch {
    return d
  }
}

export function PickerInventoryDetailPage() {
  const { productId } = useParams<{ productId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation('picker')
  const [data, setData] = useState<PickerProductDetailResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!productId) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await getPickerProductDetail(productId)
      setData(res)
    } catch {
      setError(t('inventory.load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [productId, t])

  useEffect(() => {
    void load()
  }, [load])

  if (!productId) {
    navigate('/picker/inventory')
    return null
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title={t('inventory.title')} onBack={() => navigate(-1)} />
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200" />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title={t('inventory.title')} onBack={() => navigate(-1)} />
        <EmptyState
          icon={<Boxes size={32} />}
          title={error ?? t('inventory.no_results')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-6 dark:bg-slate-950">
      <AppHeader title={data.name} onBack={() => navigate(-1)} />
      <Card className="mb-4">
        <div className="text-lg font-medium text-slate-900 dark:text-slate-100">{data.name}</div>
        {data.main_barcode && (
          <div className="mt-1 text-sm text-slate-500">Barcode: {data.main_barcode}</div>
        )}
      </Card>
      <div className="text-sm font-medium text-slate-600 dark:text-slate-400">
        {t('inventory.more_locations')}
      </div>
      <div className="mt-2 space-y-2">
        {data.locations.map((loc) => (
          <Card key={`${loc.location_id}-${loc.lot_id}`}>
            <div className="flex justify-between text-sm">
              <span className="font-medium">{loc.location_code}</span>
              <span className={getExpiryColorClass(loc.expiry_date)}>
                {formatExpiry(loc.expiry_date)}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Batch: {loc.batch_no} • On hand: {loc.on_hand_qty} • Reserved: {loc.reserved_qty} • Available: {loc.available_qty}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
