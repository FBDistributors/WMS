import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Filter, Loader2, Settings, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { OrdersHubTabs, OrdersSourceSubTabs } from '../../admin/components/orders/OrdersHubTabs'
import { OrdersTableSettings } from '../../admin/components/orders/OrdersTableSettings'
import { SendToPickingDialog } from '../../admin/components/orders/SendToPickingDialog'
import { useOrikzorTableConfig } from '../../admin/hooks/useMovementsTableConfig'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { DateInput } from '../../components/DateInput'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { getOrders, syncSmartupOrders, type OrderListItem, type SmartupSyncResult } from '../../services/ordersApi'
import { useAuth } from '../../rbac/AuthProvider'

const PAGE_SIZE = 50

const COLUMNS_ORIKZOR = [
  { id: 'select', labelKey: 'orders:columns.select' },
  { id: 'order_number', labelKey: 'orders:columns_diller.movement_number' },
  { id: 'movement_note', labelKey: 'orders:columns_diller.movement_note' },
  { id: 'status', labelKey: 'orders:columns_diller.status' },
  { id: 'lines', labelKey: 'orders:columns_diller.lines' },
  { id: 'delivery_date', labelKey: 'orders:columns_diller.delivery_date' },
  { id: 'view_details', labelKey: 'orders:columns_diller.view_details' },
] as const

const ORIKZOR_SEARCH_FIELD_OPTIONS = [
  { id: 'order_number', labelKey: 'orders:columns_diller.movement_number' },
  { id: 'movement_note', labelKey: 'orders:columns_diller.movement_note' },
  { id: 'status', labelKey: 'orders:columns_diller.status' },
]

type OrikzorColumnId = (typeof COLUMNS_ORIKZOR)[number]['id']

export function OrikzorHarakatlariPage() {
  const { t } = useTranslation(['orders', 'common', 'admin'])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10))
  const searchQuery = searchParams.get('q') ?? ''
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''

  const [items, setItems] = useState<OrderListItem[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<SmartupSyncResult | null>(null)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [filterDateFrom, setFilterDateFrom] = useState(dateFrom)
  const [filterDateTo, setFilterDateTo] = useState(dateTo)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const { has: hasPermission } = useAuth()
  const canSendToPicking = hasPermission('orders:send_to_picking')
  const canSync = hasPermission('orders:sync')
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [sendDialogOrderIds, setSendDialogOrderIds] = useState<string[] | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const orikzorTableConfig = useOrikzorTableConfig()

  const load = useCallback(
    async (background = false) => {
      if (!background) setIsLoading(true)
      else setIsRefreshing(true)
      setError(null)
      try {
        const data = await getOrders({
          order_source: 'orikzor',
          status: 'imported',
          q: searchQuery.trim() || undefined,
          date_from: dateFrom.trim() || undefined,
          date_to: dateTo.trim() || undefined,
          limit: PAGE_SIZE,
          offset,
          filial_id: 'all',
        })
        setItems(data.items)
        setTotal(data.total)
      } catch (err) {
        if (!background) {
          setError(err instanceof Error ? err.message : t('orders:load_failed'))
        }
      } finally {
        if (!background) setIsLoading(false)
        else setIsRefreshing(false)
      }
    },
    [dateFrom, dateTo, offset, searchQuery, t],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (filterPanelOpen) {
      setFilterDateFrom(dateFrom)
      setFilterDateTo(dateTo)
    }
  }, [filterPanelOpen, dateFrom, dateTo])

  const handleSync = useCallback(async () => {
    setIsSyncing(true)
    setSyncError(null)
    setSyncResult(null)
    try {
      try {
        const result = await syncSmartupOrders({ order_source: 'orikzor' })
        setSyncResult(result)
      } catch (syncErr) {
        const errStatus = syncErr && typeof syncErr === 'object' && 'status' in syncErr ? (syncErr as { status: number }).status : 0
        if (errStatus === 409) {
          setSyncError(t('orders:sync_busy'))
        } else {
          const message =
            (syncErr && typeof syncErr === 'object' && 'message' in syncErr && typeof (syncErr as { message: unknown }).message === 'string')
              ? (syncErr as { message: string }).message
              : syncErr instanceof Error
                ? syncErr.message
                : t('orders:sync_failed')
          setSyncError(message)
        }
      }
      await load(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('orders:sync_failed')
      setSyncError(message)
    } finally {
      setIsSyncing(false)
    }
  }, [load, t])

  const columnLabels = useMemo(
    () => new Map(COLUMNS_ORIKZOR.map((c) => [c.id, t(c.labelKey)])),
    [t],
  )

  const renderCell = (columnId: OrikzorColumnId, order: OrderListItem) => {
    switch (columnId) {
      case 'select':
        if (!canSendToPicking) return null
        {
          const checked = selectedOrderIds.has(order.id)
          return (
            <td className="px-4 py-3">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
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
      case 'movement_note':
        return (
          <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300" title={order.movement_note ?? ''}>
            {order.movement_note ?? '—'}
          </td>
        )
      case 'status':
        return (
          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{order.status}</td>
        )
      case 'lines':
        return (
          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{order.lines_total}</td>
        )
      case 'delivery_date':
        return (
          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
            {order.delivery_date ?? order.created_at?.slice(0, 10) ?? '—'}
          </td>
        )
      case 'view_details':
        return (
          <td className="px-4 py-3">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => navigate(`/admin/orders/${order.id}`)}
              aria-label={t('orders:view_details')}
            >
              <FileText size={18} />
            </button>
          </td>
        )
      default:
        return null
    }
  }

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="relative flex-1 min-h-[200px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
    }
    if (error) {
      return (
        <EmptyState
          title={error}
          actionLabel={t('common:buttons.retry')}
          onAction={() => load()}
        />
      )
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={searchQuery.trim() ? t('orders:search_no_results', "Qidiruv bo'yicha natija topilmadi") : t('orders:empty')}
          description={searchQuery.trim() ? t('orders:search_no_results_hint', "Boshqa so'z yoki filterni sinab ko'ring.") : t('orders:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={() => (searchQuery.trim() ? setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('q'); return n }) : load())}
        />
      )
    }
    const visibleCols = new Set(orikzorTableConfig.config.visibleColumns.filter((id) => COLUMNS_ORIKZOR.some((c) => c.id === id)))
    const orderedCols = orikzorTableConfig.config.columnOrder.filter((id) => COLUMNS_ORIKZOR.some((c) => c.id === id)) as OrikzorColumnId[]
    return (
      <TableScrollArea inline>
        <table className="w-max min-w-[600px] table-auto text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {orderedCols.map((colId) =>
                visibleCols.has(colId) ? (
                  <th key={colId} className="px-4 py-3 text-left">
                    {colId === 'select' && canSendToPicking ? (
                      <input
                        type="checkbox"
                        checked={items.length > 0 && items.every((o) => selectedOrderIds.has(o.id))}
                        ref={(el) => {
                          if (el) {
                            const some = items.some((o) => selectedOrderIds.has(o.id))
                            el.indeterminate = some && !items.every((o) => selectedOrderIds.has(o.id))
                          }
                        }}
                        onChange={() =>
                          setSelectedOrderIds(
                            items.every((o) => selectedOrderIds.has(o.id))
                              ? new Set()
                              : new Set(items.map((o) => o.id)),
                          )
                        }
                        aria-label={t('orders:select_all')}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    ) : (
                      columnLabels.get(colId)
                    )}
                  </th>
                ) : null,
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((order) => (
              <tr
                key={order.id}
                className="border-b border-slate-100 dark:border-slate-800"
              >
                {orderedCols.map((colId) =>
                  visibleCols.has(colId) ? (
                    <td key={colId} className="contents">
                      {renderCell(colId, order)}
                    </td>
                  ) : null,
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSendToPicking, error, isLoading, items, total, load, columnLabels, navigate, orikzorTableConfig.config, searchParams, selectedOrderIds, t])

  return (
    <AdminLayout titleSlot={<OrdersHubTabs />}>
      <Card className="space-y-4">
        <OrdersSourceSubTabs />
        <div className="flex flex-nowrap items-end gap-3">
          <label className="min-w-[180px] flex-1 max-w-md text-sm text-slate-600 dark:text-slate-300">
            <span className="sr-only">{t('orders:filters.search')}</span>
            <input
              type="search"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
              value={searchQuery}
              onChange={(e) => {
                const v = e.target.value
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  if (v) next.set('q', v)
                  else next.delete('q')
                  next.delete('offset')
                  return next
                })
              }}
              placeholder={t('orders:filters.search_placeholder_orikzor')}
            />
          </label>
          <div className="relative shrink-0" ref={filterPanelRef}>
            <Button
              variant="outline"
              onClick={() => setFilterPanelOpen((o) => !o)}
              className="gap-2"
              aria-label={t('orders:filters.filter_btn')}
              aria-expanded={filterPanelOpen}
            >
              <Filter size={18} />
              {t('orders:filters.filter_btn')}
            </Button>
            {filterPanelOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  aria-hidden
                  onClick={() => setFilterPanelOpen(false)}
                />
                <div className="absolute right-0 top-full z-50 mt-2 w-full min-w-[280px] max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {t('orders:filters.filter_panel_title')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFilterPanelOpen(false)}
                      className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:text-slate-400 dark:hover:bg-slate-800"
                      aria-label={t('common:close')}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-sm text-slate-600 dark:text-slate-400">
                        {t('orders:filters.date_from')}
                        <DateInput
                          value={filterDateFrom}
                          onChange={setFilterDateFrom}
                          className="mt-1 w-full"
                          aria-label={t('orders:filters.date_from')}
                        />
                      </label>
                      <label className="block text-sm text-slate-600 dark:text-slate-400">
                        {t('orders:filters.date_to')}
                        <DateInput
                          value={filterDateTo}
                          onChange={setFilterDateTo}
                          className="mt-1 w-full"
                          aria-label={t('orders:filters.date_to')}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearchParams((prev) => {
                          const next = new URLSearchParams(prev)
                          next.delete('date_from')
                          next.delete('date_to')
                          next.delete('offset')
                          return next
                        })
                        setFilterPanelOpen(false)
                      }}
                    >
                      {t('orders:filters.filter_clear')}
                    </Button>
                    <Button
                      onClick={() => {
                        setSearchParams((prev) => {
                          const next = new URLSearchParams(prev)
                          const df = filterDateFrom.trim()
                          const dt = filterDateTo.trim()
                          if (df) next.set('date_from', df)
                          else next.delete('date_from')
                          if (dt) next.set('date_to', dt)
                          else next.delete('date_to')
                          next.delete('offset')
                          return next
                        })
                        setFilterPanelOpen(false)
                      }}
                    >
                      {t('orders:filters.filter_apply')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            className="shrink-0 rounded-full px-3 py-3"
            onClick={() => setIsSettingsOpen(true)}
            aria-label={t('orders:table.settings_title')}
          >
            <Settings size={18} />
          </Button>
          {canSync ? (
            <Button className="shrink-0" onClick={handleSync} disabled={isSyncing}>
              {isSyncing ? t('orders:syncing') : t('orders:sync')}
            </Button>
          ) : null}
        </div>

        {syncError ? (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/30">
            <span className="text-sm text-amber-800 dark:text-amber-200 break-words flex-1">{syncError}</span>
            <Button variant="ghost" className="shrink-0 p-2" onClick={() => setSyncError(null)} aria-label={t('common:buttons.close')}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        {(isRefreshing || syncResult) ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            {isRefreshing ? (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                {t('orders:refreshing')}
              </span>
            ) : null}
            {syncResult ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                {t('orders:sync_result', { created: syncResult.created, updated: syncResult.updated, skipped: syncResult.skipped })}
              </span>
            ) : null}
          </div>
        ) : null}

        {canSendToPicking && selectedOrderIds.size > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50">
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {t('orders:send_selected_to_picking', { count: selectedOrderIds.size })}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setSelectedOrderIds(new Set())}>
                {t('common:buttons.cancel')}
              </Button>
              <Button onClick={() => setSendDialogOrderIds([...selectedOrderIds])}>
                {t('orders:send_to_picking.button')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="relative max-h-[calc(100vh-320px)] min-h-0 overflow-auto">
          {content}
          {isSyncing && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 dark:bg-slate-900/60 backdrop-blur-[2px]">
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-2.5 text-sm font-medium text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                <Loader2 size={20} className="animate-spin shrink-0" />
                {t('orders:syncing')}
              </div>
            </div>
          )}
        </div>

        <SendToPickingDialog
          open={sendDialogOrderIds !== null}
          orderIds={sendDialogOrderIds ?? []}
          onOpenChange={(open) => !open && setSendDialogOrderIds(null)}
          onSent={() => {
            setSendDialogOrderIds(null)
            setSelectedOrderIds(new Set())
            void load(false)
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <Button variant="outline" onClick={() => load(true)} disabled={isRefreshing}>
            {t('common:buttons.refresh')}
          </Button>
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span>
              {total > 0
                ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} / ${total}`
                : '0 / 0'}
            </span>
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  next.set('offset', String(Math.max(0, offset - PAGE_SIZE)))
                  return next
                })
              }}
            >
              {t('common:buttons.back')}
            </Button>
            <Button
              variant="secondary"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  next.set('offset', String(offset + PAGE_SIZE))
                  return next
                })
              }}
            >
              {t('common:buttons.next')}
            </Button>
          </div>
        </div>
      </Card>
      <OrdersTableSettings
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        config={orikzorTableConfig.config}
        columns={COLUMNS_ORIKZOR.map((column) => ({
          id: column.id,
          label: t(column.labelKey),
        }))}
        searchFields={ORIKZOR_SEARCH_FIELD_OPTIONS.map((field) => ({
          id: field.id,
          label: t(field.labelKey),
        }))}
        onSave={orikzorTableConfig.updateConfig}
        onReset={orikzorTableConfig.resetConfig}
      />
    </AdminLayout>
  )
}
