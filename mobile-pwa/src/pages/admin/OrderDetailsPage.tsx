import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getOrder, packOrder, shipOrder, type OrderDetails } from '../../services/ordersApi'
import { useAuth } from '../../rbac/AuthProvider'

export function OrderDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation(['orders', 'common'])
  const { has } = useAuth()
  const [order, setOrder] = useState<OrderDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  const canEditStatus = has('documents:edit_status')

  const load = useCallback(async () => {
    if (!id) {
      setLoadError(t('orders:not_found'))
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setLoadError(null)
    setActionError(null)
    try {
      const data = await getOrder(id)
      setOrder(data)
    } catch (err) {
      setLoadError(t('orders:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

  const handlePack = async () => {
    if (!order) return
    setIsUpdating(true)
    setActionError(null)
    try {
      await packOrder(order.id)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('orders:pack_failed'))
    } finally {
      setIsUpdating(false)
    }
  }

  const handleShip = async () => {
    if (!order) return
    setIsUpdating(true)
    setActionError(null)
    try {
      await shipOrder(order.id)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('orders:ship_failed'))
    } finally {
      setIsUpdating(false)
    }
  }

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

  if (!order || loadError) {
    return (
      <AdminLayout title={t('orders:details_title')}>
        <EmptyState
          title={loadError ?? t('orders:not_found')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={t('orders:details_title')}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
            {t('common:buttons.back')}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {canEditStatus && order.status === 'picked' ? (
              <Button onClick={handlePack} disabled={isUpdating}>
                {isUpdating ? t('orders:packing') : t('orders:pack')}
              </Button>
            ) : null}
            {canEditStatus && order.status === 'packed' ? (
              <Button onClick={handleShip} disabled={isUpdating}>
                {isUpdating ? t('orders:shipping') : t('orders:ship')}
              </Button>
            ) : null}
          </div>
        </div>
        {actionError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
            {actionError}
          </div>
        ) : null}
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
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {t(`orders:status.${order.status === 'B#S' ? 'b#s' : order.status}`, order.status)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.customer')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {order.customer_name ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.customer_id')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {order.customer_id ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.agent')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {order.agent_name ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.agent_id')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {order.agent_id ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.total_amount')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {order.total_amount == null ? '—' : Number(order.total_amount).toLocaleString()}
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
