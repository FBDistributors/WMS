import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { SendToPickingDialog } from '../../admin/components/orders/SendToPickingDialog'
import { OrdersTableSettings } from '../../admin/components/orders/OrdersTableSettings'
import { useOrdersTableConfig } from '../../admin/hooks/useOrdersTableConfig'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getOrders, syncSmartupOrders, type OrderListItem } from '../../services/ordersApi'
import { useAuth } from '../../rbac/AuthProvider'

const PAGE_SIZE = 50
const COLUMN_OPTIONS = [
  { id: 'order_number', labelKey: 'orders:columns.order_number' },
  { id: 'external_id', labelKey: 'orders:columns.external_id' },
  { id: 'customer', labelKey: 'orders:columns.customer' },
  { id: 'customer_id', labelKey: 'orders:columns.customer_id' },
  { id: 'agent', labelKey: 'orders:columns.agent' },
  { id: 'total_amount', labelKey: 'orders:columns.total_amount' },
  { id: 'status', labelKey: 'orders:columns.status' },
  { id: 'lines', labelKey: 'orders:columns.lines' },
  { id: 'created', labelKey: 'orders:columns.created' },
  { id: 'actions', labelKey: 'orders:columns.actions' },
]

const SEARCH_FIELD_OPTIONS = [
  { id: 'order_number', labelKey: 'orders:search_fields.order_number' },
  { id: 'external_id', labelKey: 'orders:search_fields.external_id' },
  { id: 'customer', labelKey: 'orders:search_fields.customer' },
  { id: 'customer_id', labelKey: 'orders:search_fields.customer_id' },
  { id: 'agent', labelKey: 'orders:search_fields.agent' },
]

export function OrdersPage() {
  const { t } = useTranslation(['orders', 'common'])
  const navigate = useNavigate()
  const { has } = useAuth()
  const canSync = has('orders:sync')
  const canSend = has('orders:send_to_picking') && has('picking:assign')

  const { config, updateConfig, resetConfig } = useOrdersTableConfig()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const [items, setItems] = useState<OrderListItem[]>([])
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
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
        search_fields: config.searchFields.length > 0 ? config.searchFields.join(',') : undefined,
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
  }, [config.searchFields, offset, search, status, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setOffset(0)
  }, [status, search])

  const handleSync = async () => {
    setIsSyncing(true)
    setError(null)
    try {
      await syncSmartupOrders()
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
    const visibleColumns = new Set(config.visibleColumns)
    const orderedColumns = config.columnOrder.filter((id) =>
      COLUMN_OPTIONS.some((column) => column.id === id)
    )
    const columnLabels = new Map(
      COLUMN_OPTIONS.map((column) => [column.id, t(column.labelKey)])
    )
    const renderCell = (columnId: string, order: OrderListItem) => {
      switch (columnId) {
        case 'order_number':
          return (
            <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
              {order.order_number}
            </td>
          )
        case 'external_id':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.source_external_id}
            </td>
          )
        case 'customer':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.customer_name ?? '—'}
            </td>
          )
        case 'customer_id':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.customer_id ?? '—'}
            </td>
          )
        case 'agent':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.agent_name ?? '—'}
            </td>
          )
        case 'total_amount':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.total_amount == null ? '—' : Number(order.total_amount).toLocaleString()}
            </td>
          )
        case 'status':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {t(`orders:status.${order.status === 'B#S' ? 'b#s' : order.status}`, order.status)}
            </td>
          )
        case 'lines':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.lines_total}
            </td>
          )
        case 'created':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {new Date(order.created_at).toLocaleDateString()}
            </td>
          )
        case 'actions':
          return (
            <td className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" onClick={() => navigate(`/admin/orders/${order.id}`)}>
                  {t('orders:view_details')}
                </Button>
                {canSend ? (
                  <Button variant="secondary" onClick={() => setSelectedOrderId(order.id)}>
                    {t('orders:send_to_picking.button')}
                  </Button>
                ) : null}
              </div>
            </td>
          )
        default:
          return null
      }
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {orderedColumns.map((columnId) =>
                visibleColumns.has(columnId) ? (
                  <th key={columnId} className="px-4 py-3 text-left">
                    {columnLabels.get(columnId)}
                  </th>
                ) : null
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((order) => (
              <tr key={order.id} className="border-b border-slate-100 dark:border-slate-800">
                {orderedColumns.map((columnId) =>
                  visibleColumns.has(columnId) ? renderCell(columnId, order) : null
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }, [canSend, config.columnOrder, config.visibleColumns, error, isLoading, items, load, navigate, t])

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
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="rounded-full px-3 py-3"
              onClick={() => setIsSettingsOpen(true)}
              aria-label={t('orders:table.settings_title')}
            >
              <Settings size={18} />
            </Button>
            {canSync ? (
              <Button onClick={handleSync} disabled={isSyncing}>
                {isSyncing ? t('orders:syncing') : t('orders:sync')}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
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
      <OrdersTableSettings
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        config={config}
        columns={COLUMN_OPTIONS.map((column) => ({
          id: column.id,
          label: t(column.labelKey),
        }))}
        searchFields={SEARCH_FIELD_OPTIONS.map((field) => ({
          id: field.id,
          label: t(field.labelKey),
        }))}
        onSave={updateConfig}
        onReset={resetConfig}
      />
    </AdminLayout>
  )
}
