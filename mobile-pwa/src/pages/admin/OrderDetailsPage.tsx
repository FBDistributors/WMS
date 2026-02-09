import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getOrder, type OrderDetails } from '../../services/ordersApi'

export function OrderDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation(['orders', 'common'])
  const [order, setOrder] = useState<OrderDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) {
      setError(t('orders:not_found'))
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const data = await getOrder(id)
      setOrder(data)
    } catch (err) {
      setError(t('orders:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    void load()
  }, [load])

  if (isLoading) {
    return (
      <AdminLayout title={t('orders:details_title')}>
        <div className="h-32 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </AdminLayout>
    )
  }

  if (!order || error) {
    return (
      <AdminLayout title={t('orders:details_title')}>
        <EmptyState
          title={error ?? t('orders:not_found')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      </AdminLayout>
    )
  }

  return (
    <AdminLayout
      title={t('orders:details_title')}
      actionSlot={
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          {t('common:buttons.back')}
        </Button>
      }
    >
      <Card className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.order_number')}</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {order.order_number}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.external_id')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{order.source_external_id}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.status')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{order.status}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.customer')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {order.customer_name ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.created')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {new Date(order.created_at).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.lines')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{order.lines.length}</div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="px-4 py-3 text-left">{t('orders:lines.sku')}</th>
                <th className="px-4 py-3 text-left">{t('orders:lines.barcode')}</th>
                <th className="px-4 py-3 text-left">{t('orders:lines.name')}</th>
                <th className="px-4 py-3 text-left">{t('orders:lines.qty')}</th>
                <th className="px-4 py-3 text-left">{t('orders:lines.uom')}</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3">{line.sku ?? '—'}</td>
                  <td className="px-4 py-3">{line.barcode ?? '—'}</td>
                  <td className="px-4 py-3">{line.name}</td>
                  <td className="px-4 py-3">{line.qty}</td>
                  <td className="px-4 py-3">{line.uom ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AdminLayout>
  )
}
