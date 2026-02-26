import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Settings, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { SendToPickingDialog } from '../../admin/components/orders/SendToPickingDialog'
import { OrdersTableSettings } from '../../admin/components/orders/OrdersTableSettings'
import { useOrdersTableConfig } from '../../admin/hooks/useOrdersTableConfig'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getOrders, syncSmartupOrders, updateOrderStatus, type OrderListItem } from '../../services/ordersApi'
import { useAuth } from '../../rbac/AuthProvider'

const PAGE_SIZE = 50
const COLUMN_OPTIONS = [
  { id: 'select', labelKey: 'orders:columns.select' },
  { id: 'order_number', labelKey: 'orders:columns.order_number' },
  { id: 'external_id', labelKey: 'orders:columns.external_id' },
  { id: 'customer', labelKey: 'orders:columns.customer' },
  { id: 'customer_id', labelKey: 'orders:columns.customer_id' },
  { id: 'agent', labelKey: 'orders:columns.agent' },
  { id: 'total_amount', labelKey: 'orders:columns.total_amount' },
  { id: 'status', labelKey: 'orders:columns.status' },
  { id: 'lines', labelKey: 'orders:columns.lines' },
  { id: 'created', labelKey: 'orders:columns.created' },
  { id: 'view_details', labelKey: 'orders:columns.view_details' },
  { id: 'send_to_picking', labelKey: 'orders:columns.send_to_picking' },
  { id: 'picker', labelKey: 'orders:columns.picker' },
  { id: 'controller', labelKey: 'orders:columns.controller' },
]

const COLUMN_OPTIONS_DEFAULT = COLUMN_OPTIONS.filter((c) => c.id !== 'status')

// Dropdown da faqat 3 ta status: Yig'ishda, Tekshiruvda, Yakunlangan (backend ga picking / picked / completed yuboriladi)
const SIMPLE_STATUS_OPTIONS = [
  { value: 'picking', labelKey: 'orders:status_simple.yigishda' },
  { value: 'picked', labelKey: 'orders:status_simple.tekshiruvda' },
  { value: 'completed', labelKey: 'orders:status_simple.yakunlash' },
] as const

function backendStatusToSimple(status: string): string {
  if (['imported', 'B#S', 'allocated', 'ready_for_picking', 'picking'].includes(status)) return 'picking'
  if (status === 'picked') return 'picked'
  return 'completed' // completed, packed, shipped, cancelled
}

// Buyurtma statuslari sahifasi: faqat ma'lumot, yig'ishga yuborish yo'q; yig'uvchi va kontrolyor ustunlari
const COLUMN_OPTIONS_STATUSES = [
  { id: 'order_number', labelKey: 'orders:columns.order_number' },
  { id: 'external_id', labelKey: 'orders:columns.external_id' },
  { id: 'customer', labelKey: 'orders:columns.customer' },
  { id: 'customer_id', labelKey: 'orders:columns.customer_id' },
  { id: 'agent', labelKey: 'orders:columns.agent' },
  { id: 'total_amount', labelKey: 'orders:columns.total_amount' },
  { id: 'status', labelKey: 'orders:columns.status' },
  { id: 'change_status', labelKey: 'orders:columns.change_status' },
  { id: 'lines', labelKey: 'orders:columns.lines' },
  { id: 'created', labelKey: 'orders:columns.created' },
  { id: 'view_details', labelKey: 'orders:columns.view_details' },
  { id: 'picker', labelKey: 'orders:columns.picker' },
  { id: 'controller', labelKey: 'orders:columns.controller' },
]

const SEARCH_FIELD_OPTIONS = [
  { id: 'order_number', labelKey: 'orders:search_fields.order_number' },
  { id: 'external_id', labelKey: 'orders:search_fields.external_id' },
  { id: 'customer', labelKey: 'orders:search_fields.customer' },
  { id: 'customer_id', labelKey: 'orders:search_fields.customer_id' },
  { id: 'agent', labelKey: 'orders:search_fields.agent' },
]

const GROUP_TO_STATUS: Record<string, string | undefined> = {
  xom: 'imported,B#S', // Yangi: Smartupdan kelgan, admin yig'uvchiga yubormagan
  yigishda: 'allocated,ready_for_picking,picking', // Yig'uvchi yig'ishda / controllerga yubormagan
  tekshiruvda: 'picked', // Controllerga yuborilgan, controller yakunlamagan
  yakunlangan: 'completed,packed,shipped', // Controller yakunlagan yoki qadoqlangan
  all: undefined,
}

type OrdersPageProps = { mode?: 'default' | 'statuses'; orderSource?: 'diller' | 'orikzor' }

export function OrdersPage({ mode = 'default', orderSource }: OrdersPageProps) {
  const { t } = useTranslation(['orders', 'common', 'admin'])
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const group = searchParams.get('group') ?? 'all'
  const pageTitle = orderSource
    ? t(`admin:menu.orders_${orderSource}`, orderSource === 'diller' ? 'Diller buyurtmalar' : "O'rikzor buyurtmalar")
    : mode === 'statuses'
      ? t('admin:dashboard.order_statuses_title')
      : t('orders:title')
  // Asosiy Buyurtmalar sahifasida faqat B#S; Diller/O'rikzor va statuses rejimida group bo'yicha
  const statusParam = orderSource
    ? (GROUP_TO_STATUS[group] ?? undefined)
    : mode === 'default' && (group === 'all' || !searchParams.get('group'))
      ? 'B#S'
      : (GROUP_TO_STATUS[group] ?? GROUP_TO_STATUS.all)
  const { has } = useAuth()
  const canSync = has('orders:write')
  const canSend = has('orders:write')
  const canEditStatus = has('documents:edit_status')
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)

  const { config, updateConfig, resetConfig } = useOrdersTableConfig()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const [items, setItems] = useState<OrderListItem[]>([])
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [sendDialogOrderIds, setSendDialogOrderIds] = useState<string[] | null>(null)

  const ELIGIBLE_PICKING_STATUSES = new Set(['imported', 'B#S', 'ready_for_picking', 'allocated'])
  const canBeSentToPicking = (order: OrderListItem) =>
    canSend && ELIGIBLE_PICKING_STATUSES.has(order.status)
  const eligibleItems = useMemo(
    () => items.filter((o) => ELIGIBLE_PICKING_STATUSES.has(o.status)),
    [items]
  )

  const load = useCallback(async (background = false) => {
    if (!background) {
      setIsLoading(true)
      setError(null)
    } else {
      setIsRefreshing(true)
    }
    try {
      const data = await getOrders({
        status: statusParam,
        q: search || undefined,
        search_fields: config.searchFields.length > 0 ? config.searchFields.join(',') : undefined,
        limit: PAGE_SIZE,
        offset,
        ...(orderSource ? { order_source: orderSource } : {}),
      })
      setItems(data.items)
      setTotal(data.total)
    } catch (err) {
      if (!background) {
        const message = err instanceof Error ? err.message : t('orders:load_failed')
        setError(message)
      }
    } finally {
      if (!background) setIsLoading(false)
      else setIsRefreshing(false)
    }
  }, [config.searchFields, offset, orderSource, search, statusParam, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setOffset(0)
  }, [group])

  // Avtoyangilash: orqada yangilash — jadval o‘chirilmasdan, chaqnashsiz
  useEffect(() => {
    if (typeof document === 'undefined') return
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void load(true)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      clearInterval(interval)
    }
  }, [load])

  useEffect(() => {
    setOffset(0)
  }, [search])

  const handleSync = async () => {
    setIsSyncing(true)
    setError(null)
    try {
      await syncSmartupOrders(orderSource ? { order_source: orderSource } : {})
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
    const columnOptionsForMode =
      mode === 'statuses'
        ? COLUMN_OPTIONS_STATUSES
        : mode === 'default'
          ? COLUMN_OPTIONS_DEFAULT
          : COLUMN_OPTIONS
    const visibleColumns =
      mode === 'statuses'
        ? new Set(COLUMN_OPTIONS_STATUSES.map((c) => c.id))
        : new Set(
            mode === 'default'
              ? config.visibleColumns.filter((id) => id !== 'status')
              : config.visibleColumns
          )
    const orderedColumns =
      mode === 'statuses'
        ? COLUMN_OPTIONS_STATUSES.map((c) => c.id)
        : config.columnOrder.filter((id) =>
            columnOptionsForMode.some((column) => column.id === id)
          )
    const getStatusRowClass = (order: OrderListItem) => {
      if (mode !== 'statuses') return ''
      if (order.is_incomplete) return 'bg-red-50 dark:bg-red-950/30'
      const status = order.status
      if (status === 'allocated' || status === 'ready_for_picking' || status === 'picking')
        return 'bg-blue-50 dark:bg-blue-950/30'
      if (status === 'picked') return 'bg-amber-50 dark:bg-amber-950/30'
      if (status === 'completed' || status === 'packed' || status === 'shipped')
        return 'bg-emerald-50 dark:bg-emerald-950/30'
      return ''
    }
    const columnLabels = new Map(
      columnOptionsForMode.map((column) => [column.id, t(column.labelKey)])
    )
    const renderCell = (columnId: string, order: OrderListItem) => {
      switch (columnId) {
        case 'select':
          if (!canSend) return null
          {
            const eligible = canBeSentToPicking(order)
            const checked = selectedOrderIds.has(order.id)
            return (
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!eligible}
                  onChange={() => {
                    if (!eligible) return
                    setSelectedOrderIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(order.id)) next.delete(order.id)
                      else next.add(order.id)
                      return next
                    })
                  }}
                  aria-label={t('orders:select_all')}
                  className="h-4 w-4 rounded border-slate-300"
                />
              </td>
            )
          }
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
              <span className="inline-flex items-center gap-1.5">
                {t(`orders:status.${order.status === 'B#S' ? 'b#s' : order.status}`, order.status)}
                {order.is_incomplete && (
                  <span className="rounded bg-red-200 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/60 dark:text-red-200">
                    {t('orders:incomplete_badge', 'To\'liq emas')}
                  </span>
                )}
              </span>
            </td>
          )
        case 'change_status':
          if (!canEditStatus)
            return (
              <td className="px-4 py-3 text-slate-400 dark:text-slate-600">—</td>
            )
          {
            const isUpdating = updatingOrderId === order.id
            const simpleValue = backendStatusToSimple(order.status)
            return (
              <td className="px-4 py-3">
                <select
                  value={simpleValue}
                  disabled={isUpdating}
                  onChange={async (e) => {
                    const newSimple = e.target.value as 'picking' | 'picked' | 'completed'
                    const backendStatus = newSimple // picking / picked / completed backend da qabul qilinadi
                    if (backendStatus === order.status) return
                    setUpdatingOrderId(order.id)
                    try {
                      await updateOrderStatus(order.id, backendStatus)
                      await load()
                    } finally {
                      setUpdatingOrderId(null)
                    }
                  }}
                  className="min-w-[140px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 disabled:opacity-60"
                  aria-label={t('orders:columns.change_status')}
                >
                  {SIMPLE_STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {t(s.labelKey)}
                    </option>
                  ))}
                </select>
              </td>
            )
          }
        case 'picker':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.picker_name ?? '—'}
            </td>
          )
        case 'controller':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.controller_name ?? '—'}
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
        case 'view_details':
          return (
            <td className="px-4 py-3">
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                onClick={() => navigate(`/admin/orders/${order.id}`)}
                aria-label={t('orders:view_details')}
              >
                <FileText size={18} />
              </button>
            </td>
          )
        case 'send_to_picking':
          return (
            <td className="px-4 py-3">
              {canSend ? (
                <Button variant="secondary" onClick={() => setSendDialogOrderIds([order.id])}>
                  {t('orders:send_to_picking.button')}
                </Button>
              ) : (
                <span className="text-slate-400 dark:text-slate-600">—</span>
              )}
            </td>
          )
        default:
          return null
      }
    }

    return (
      <TableScrollArea inline>
        <table className="w-max min-w-[600px] text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {orderedColumns.map((columnId) =>
                visibleColumns.has(columnId) ? (
                  <th key={columnId} className="px-4 py-3 text-left">
                    {columnId === 'select' && canSend ? (
                      (() => {
                        const allSelected =
                          eligibleItems.length > 0 &&
                          eligibleItems.every((o) => selectedOrderIds.has(o.id))
                        const someSelected = eligibleItems.some((o) => selectedOrderIds.has(o.id))
                        return (
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = someSelected && !allSelected
                            }}
                            onChange={() =>
                              setSelectedOrderIds(
                                allSelected ? new Set() : new Set(eligibleItems.map((o) => o.id))
                              )
                            }
                            aria-label={t('orders:select_all')}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        )
                      })()
                    ) : (
                      columnLabels.get(columnId)
                    )}
                  </th>
                ) : null
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((order) => (
              <tr
                key={order.id}
                className={`border-b border-slate-100 dark:border-slate-800 ${getStatusRowClass(order)}`}
              >
                {orderedColumns.map((columnId) =>
                  visibleColumns.has(columnId) ? renderCell(columnId, order) : null
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [canEditStatus, canSend, config.columnOrder, config.visibleColumns, eligibleItems, error, isLoading, items, load, mode, navigate, selectedOrderIds, t, updatingOrderId])

  return (
    <AdminLayout title={pageTitle} backTo={mode === 'statuses' ? '/admin' : undefined}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {pageTitle}
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <span>{t('orders:subtitle')}</span>
              {group && group !== 'all' ? (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                  {t(`admin:dashboard.status_${group}`)}
                </span>
              ) : null}
              {isRefreshing ? (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                  {t('orders:refreshing')}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode !== 'statuses' ? (
              <Button
                variant="ghost"
                className="rounded-full px-3 py-3"
                onClick={() => setIsSettingsOpen(true)}
                aria-label={t('orders:table.settings_title')}
              >
                <Settings size={18} />
              </Button>
            ) : null}
            {canSync && mode !== 'statuses' ? (
              <Button onClick={handleSync} disabled={isSyncing}>
                {isSyncing ? t('orders:syncing') : t('orders:sync')}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('orders:filters.search')}
            <input
              className="mt-1 w-full max-w-md rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('orders:filters.search_placeholder')}
            />
          </label>
        </div>

        {mode !== 'statuses' && canSend && selectedOrderIds.size > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50">
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {t('orders:send_selected_to_picking', { count: selectedOrderIds.size })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setSelectedOrderIds(new Set())}
              >
                {t('common:buttons.cancel')}
              </Button>
              <Button
                onClick={() => setSendDialogOrderIds(Array.from(selectedOrderIds))}
              >
                {t('orders:send_to_picking.button')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="max-h-[calc(100vh-320px)] min-h-0 overflow-auto">
          {content}
        </div>

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

      {mode !== 'statuses' ? (
        <SendToPickingDialog
          open={sendDialogOrderIds !== null}
          orderIds={sendDialogOrderIds ?? []}
          onOpenChange={(open) => !open && setSendDialogOrderIds(null)}
          onSent={() => {
            setSendDialogOrderIds(null)
            setSelectedOrderIds(new Set())
            void load()
          }}
        />
      ) : null}
      <OrdersTableSettings
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        config={config}
        columns={(mode === 'statuses' ? COLUMN_OPTIONS_STATUSES : mode === 'default' ? COLUMN_OPTIONS_DEFAULT : COLUMN_OPTIONS).map((column) => ({
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
