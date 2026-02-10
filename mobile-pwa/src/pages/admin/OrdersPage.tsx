import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { SendToPickingDialog } from '../../admin/components/orders/SendToPickingDialog'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getOrders, syncSmartupOrders, type OrderListItem } from '../../services/ordersApi'
import { useAuth } from '../../rbac/AuthProvider'

const PAGE_SIZE = 50

export function OrdersPage() {
  const { t } = useTranslation(['orders', 'common'])
  const navigate = useNavigate()
  const { has } = useAuth()
  const canSync = has('orders:sync')
  const canSend = has('orders:send_to_picking') && has('picking:assign')

  const today = new Date().toISOString().slice(0, 10)
  const [items, setItems] = useState<OrderListItem[]>([])
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [filialId, setFilialId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getOrders({
        status: status === 'all' ? undefined : status,
        q: search || undefined,
        filial_id: filialId || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('orders:load_failed')
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [dateFrom, dateTo, filialId, offset, search, status, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setOffset(0)
  }, [status, search, filialId, dateFrom, dateTo])

  const handleSync = async () => {
    setIsSyncing(true)
    setError(null)
    try {
      const begin = dateFrom || today
      const end = dateTo || today
      await syncSmartupOrders({
        begin_deal_date: begin,
        end_deal_date: end,
        filial_code: filialId || null,
      })
      await load()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('orders:sync_failed')
      setError(message)
    } finally {
      setIsSyncing(false)
    }
  }

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return (
        <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
      )
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('orders:empty')}
          description={t('orders:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-4 py-3 text-left">{t('orders:columns.order_number')}</th>
              <th className="px-4 py-3 text-left">{t('orders:columns.external_id')}</th>
              <th className="px-4 py-3 text-left">{t('orders:columns.customer')}</th>
              <th className="px-4 py-3 text-left">{t('orders:columns.status')}</th>
              <th className="px-4 py-3 text-left">{t('orders:columns.lines')}</th>
              <th className="px-4 py-3 text-left">{t('orders:columns.created')}</th>
              <th className="px-4 py-3 text-left">{t('orders:columns.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((order) => (
              <tr key={order.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                  {order.order_number}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {order.source_external_id}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {order.customer_name ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {t(`orders:status.${order.status === 'B#S' ? 'b#s' : order.status}`, order.status)}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{order.lines_total}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {new Date(order.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="ghost" onClick={() => navigate(`/admin/orders/${order.id}`)}>
                      {t('orders:view_details')}
                    </Button>
                    {canSend ? (
                      <Button
                        variant="secondary"
                        onClick={() => setSelectedOrderId(order.id)}
                      >
                        {t('orders:send_to_picking.button')}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }, [canSend, error, isLoading, items, load, t])

  return (
    <AdminLayout title={t('orders:title')}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('orders:title')}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t('orders:subtitle')}
            </div>
          </div>
          {canSync ? (
            <Button onClick={handleSync} disabled={isSyncing}>
              {isSyncing ? t('orders:syncing') : t('orders:sync')}
            </Button>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('orders:filters.status')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">{t('orders:filters.all')}</option>
              <option value="B#S">{t('orders:status.b#s')}</option>
              <option value="imported">{t('orders:status.imported')}</option>
              <option value="allocated">{t('orders:status.allocated')}</option>
              <option value="ready_for_picking">{t('orders:status.ready_for_picking')}</option>
              <option value="picking">{t('orders:status.picking')}</option>
              <option value="picked">{t('orders:status.picked')}</option>
              <option value="packed">{t('orders:status.packed')}</option>
              <option value="shipped">{t('orders:status.shipped')}</option>
              <option value="cancelled">{t('orders:status.cancelled')}</option>
            </select>
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('orders:filters.search')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('orders:filters.search_placeholder')}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('orders:filters.filial')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={filialId}
              onChange={(event) => setFilialId(event.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('orders:filters.date_from')}
            <input
              type="date"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('orders:filters.date_to')}
            <input
              type="date"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
        </div>

        {content}

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset((prev) => Math.max(prev - PAGE_SIZE, 0))}
          >
            {t('common:buttons.back')}
          </Button>
          <Button
            variant="secondary"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
          >
            {t('common:buttons.next')}
          </Button>
        </div>
      </Card>

      <SendToPickingDialog
        open={Boolean(selectedOrderId)}
        orderId={selectedOrderId}
        onOpenChange={(open) => !open && setSelectedOrderId(null)}
        onSent={() => void load()}
      />
    </AdminLayout>
  )
}
