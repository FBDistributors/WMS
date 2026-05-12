import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Filter, RefreshCw, Settings, X, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { OrdersHubTabs } from '../../admin/components/orders/OrdersHubTabs'
import { OrderWmsStatusCell } from '../../admin/components/orders/OrderWmsStatusCell'
import { OrdersTableSettings } from '../../admin/components/orders/OrdersTableSettings'
import { SendToPickingDialog } from '../../admin/components/orders/SendToPickingDialog'
import { usePickListsTableConfig, PICKLISTS_COLUMN_IDS } from '../../admin/hooks/usePickListsTableConfig'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { TableScrollArea } from '../../components/TableScrollArea'
import { listPickLists, cancelPickList, type PickList, type PickListStatus, type ListPickListsOptions } from '../../services/pickingApi'
import { updateOrderStatus } from '../../services/ordersApi'
import { useAuth } from '../../rbac/AuthProvider'

const PAGE_SIZE = 200

/** Jarayon: hujjat yakunlangan (controllerdan keyin) — mapStatus emas, chunki boshqa holatlar DONE ga tushishi mumkin. */
const JARAYON_HIDDEN_DOCUMENT_STATUSES = new Set(['completed', 'packed', 'shipped'])

function statusBadgeClass(status: PickListStatus): string {
  switch (status) {
    case 'DONE':
      return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
    case 'IN_PROGRESS':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
    case 'REVIEW':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
    case 'ERROR':
      return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
    case 'UNKNOWN':
    case 'NEW':
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function formatActivity(iso: string | undefined, locale: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

const DASHBOARD_WMS_GROUPS = new Set(['yigishda', 'tekshiruvda', 'yakunlangan'])

const PICKLISTS_COLUMN_LABEL_KEYS: Record<string, string> = {
  document_no: 'picking:document_label',
  delivery_number: 'picking:column_delivery_number',
  pipeline_status: 'picking:status_label',
  doc_status: 'orders:columns.so_document_status',
  change_status: 'orders:columns.change_status',
  total_lines: 'picking:total_lines',
  picker: 'picking:column_picker',
  controller: 'picking:column_controller',
  last_activity: 'picking:last_activity',
  view: 'picking:details_title',
  cancel: 'picking:cancel_document',
}

export function PickListsPage() {
  const { t, i18n } = useTranslation(['picking', 'common', 'orders'])
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const archive = pathname.endsWith('/picking/archive')
  const cancelled = pathname.endsWith('/picking/cancelled')
  const { has, isWarehouseAdmin } = useAuth()
  const { config: tableConfig, updateConfig: updateTableConfig, resetConfig: resetTableConfig } =
    usePickListsTableConfig(archive)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const vis = useMemo(() => new Set(tableConfig.visibleColumns), [tableConfig.visibleColumns])

  const processScope = cancelled ? ('cancelled' as const) : archive ? ('archived' as const) : ('active' as const)

  const groupParam = (searchParams.get('group') || '').trim()
  const wmsGroupFromUrl = DASHBOARD_WMS_GROUPS.has(groupParam)
    ? (groupParam as 'yigishda' | 'tekshiruvda' | 'yakunlangan')
    : undefined

  const wmsGroupForApi = useMemo((): ListPickListsOptions['wmsGroup'] => {
    if (!wmsGroupFromUrl) return undefined
    if (cancelled) return undefined
    if (archive) {
      return wmsGroupFromUrl === 'yakunlangan' ? 'yakunlangan' : undefined
    }
    if (wmsGroupFromUrl === 'yakunlangan') return undefined
    return wmsGroupFromUrl
  }, [archive, cancelled, wmsGroupFromUrl])

  const [items, setItems] = useState<PickList[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [reassignDialogOrderIds, setReassignDialogOrderIds] = useState<string[] | null>(null)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDocStatus, setFilterDocStatus] = useState('')
  const [filterPicker, setFilterPicker] = useState('')
  const [filterController, setFilterController] = useState('')

  /** Keyingi sahifa uchun offset (yuklangan qatorlar soni) */
  const nextOffsetRef = useRef(0)

  const canCancel = has('documents:edit_status')
  const canReassignPickerRow = useCallback(
    (item: PickList) =>
      Boolean(item.order_id) && has('orders:write') && item.order_wms_status === 'allocated',
    [has]
  )

  const load = useCallback(
    async (opts: { background?: boolean; append?: boolean } = {}) => {
      const { background = false, append = false } = opts
      if (!background && !append) {
        setIsLoading(true)
        setError(null)
      } else if (background && !append) {
        setIsRefreshing(true)
      } else if (append) {
        setLoadingMore(true)
      }
      try {
        const offset = append ? nextOffsetRef.current : 0
        const listOpts: ListPickListsOptions = { processScope, ...(wmsGroupForApi ? { wmsGroup: wmsGroupForApi } : {}) }
        const data = await listPickLists(PAGE_SIZE, offset, listOpts)
        if (append) {
          setItems((prev) => [...prev, ...data])
          nextOffsetRef.current += data.length
        } else {
          setItems(data)
          nextOffsetRef.current = data.length
        }
        setHasMore(data.length === PAGE_SIZE)
      } catch {
        if (!append) {
          if (!background) setError(t('picking:load_error'))
        }
      } finally {
        if (!background && !append) {
          setIsLoading(false)
        } else if (background && !append) {
          setIsRefreshing(false)
        } else if (append) {
          setLoadingMore(false)
        }
      }
    },
    [processScope, t, wmsGroupForApi]
  )

  useEffect(() => {
    nextOffsetRef.current = 0
    void load()
  }, [load, archive, cancelled, wmsGroupForApi])

  const uniquePickers = useMemo(
    () => [...new Set(items.map((i) => i.picker_name).filter(Boolean))] as string[],
    [items]
  )
  const uniqueControllers = useMemo(
    () => [...new Set(items.map((i) => i.controller_name).filter(Boolean))] as string[],
    [items]
  )
  const uniqueStatuses = useMemo(
    () => [...new Set(items.map((i) => i.status))],
    [items]
  )
  const uniqueDocStatuses = useMemo(
    () => [...new Set(items.map((i) => i.document_status))],
    [items]
  )
  const activeFilterCount = useMemo(
    () => [filterStatus, filterDocStatus, filterPicker, filterController].filter(Boolean).length,
    [filterStatus, filterDocStatus, filterPicker, filterController]
  )

  const filtered = useMemo(() => {
    let result = items
    if (query.trim()) {
      const term = query.toLowerCase()
      result = result.filter((item) => {
        const parts = [
          item.document_no,
          item.order_number ?? '',
          item.delivery_number ?? '',
          item.order_wms_status ?? '',
          item.picker_name ?? '',
          item.controller_name ?? '',
        ]
          .join(' ')
          .toLowerCase()
        return parts.includes(term)
      })
    }
    if (filterStatus) result = result.filter((i) => i.status === filterStatus)
    if (filterDocStatus) result = result.filter((i) => i.document_status === filterDocStatus)
    if (filterPicker) result = result.filter((i) => i.picker_name === filterPicker)
    if (filterController) result = result.filter((i) => i.controller_name === filterController)
    return result
  }, [items, query, filterStatus, filterDocStatus, filterPicker, filterController])

  const tableRows = useMemo(() => {
    if (archive || cancelled) return filtered
    return filtered.filter((item) => {
      const s = item.document_status.toLowerCase().replace(/-/g, '_')
      return !JARAYON_HIDDEN_DOCUMENT_STATUSES.has(s)
    })
  }, [archive, cancelled, filtered])

  const docStatusLabel = useCallback(
    (raw: string) => {
      const k = raw.toLowerCase().replace(/-/g, '_')
      return t(`picking:doc_status.${k}`, { defaultValue: raw })
    },
    [t]
  )

  /** Jarayon: ustuvor buyurtma WMS bosqichi; buyurtmasiz hujjatda hujjat holati. */
  const pipelineStatusLabel = useCallback(
    (item: PickList) => {
      if (archive) {
        return docStatusLabel(item.document_status)
      }
      if (cancelled) {
        const wms = item.order_wms_status
        if (wms != null && String(wms).trim() !== '') {
          const k = String(wms).toLowerCase().replace(/-/g, '_')
          return t(`orders:status.${k}`, { defaultValue: wms })
        }
        return docStatusLabel(item.document_status)
      }
      const wms = item.order_wms_status
      if (wms != null && String(wms).trim() !== '') {
        const k = String(wms).toLowerCase().replace(/-/g, '_')
        return t(`orders:status.${k}`, { defaultValue: wms })
      }
      return docStatusLabel(item.document_status)
    },
    [archive, cancelled, t, docStatusLabel]
  )

  const handleCancel = useCallback(
    async (item: PickList) => {
      if (!confirm(t('picking:cancel_confirm', { doc: item.document_no }))) return
      setCancellingId(item.id)
      try {
        if (item.order_id) {
          await updateOrderStatus(item.order_id, 'cancelled')
        } else {
          await cancelPickList(item.id)
        }
        nextOffsetRef.current = 0
        void load({ background: true })
      } catch {
        setError(t('picking:cancel_error'))
      } finally {
        setCancellingId(null)
      }
    },
    [load, t]
  )

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
          onAction={() => {
            nextOffsetRef.current = 0
            void load()
          }}
        />
      )
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('picking:empty_title')}
          description={t('picking:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={() => {
            nextOffsetRef.current = 0
            void load()
          }}
        />
      )
    }
    if (query.trim() && tableRows.length === 0) {
      return (
        <EmptyState
          title={t('picking:search_empty_title')}
          description={t('picking:search_empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={() => {
            nextOffsetRef.current = 0
            void load()
          }}
        />
      )
    }
    if (tableRows.length === 0) {
      return (
        <EmptyState
          title={archive ? t('picking:empty_archive_title') : t('picking:empty_jarayon_title')}
          description={archive ? t('picking:empty_archive_desc') : t('picking:empty_jarayon_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={() => {
            nextOffsetRef.current = 0
            void load()
          }}
        />
      )
    }
    return (
      <TableScrollArea inline>
        <table className="w-max min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {vis.has('document_no') && <th className="px-4 py-3 text-left">{t('picking:document_label')}</th>}
              {vis.has('delivery_number') && <th className="px-4 py-3 text-left">{t('picking:column_delivery_number')}</th>}
              {vis.has('pipeline_status') && <th className="px-4 py-3 text-left">{t('picking:status_label')}</th>}
              {vis.has('doc_status') && <th className="px-4 py-3 text-left">{t('orders:columns.so_document_status')}</th>}
              {vis.has('change_status') && <th className="px-4 py-3 text-left">{t('orders:columns.change_status')}</th>}
              {vis.has('total_lines') && <th className="px-4 py-3 text-left">{t('picking:total_lines')}</th>}
              {vis.has('picker') && <th className="px-4 py-3 text-left">{t('picking:column_picker')}</th>}
              {vis.has('controller') && <th className="px-4 py-3 text-left">{t('picking:column_controller')}</th>}
              {vis.has('last_activity') && <th className="px-4 py-3 text-left">{t('picking:last_activity')}</th>}
              {vis.has('view') && <th className="px-4 py-3"></th>}
              {canCancel && vis.has('cancel') && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                onClick={() => navigate(`/picking/mobile-pwa/${item.id}`)}
              >
                {vis.has('document_no') && (
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                    {item.order_number?.trim() ? item.order_number.trim() : item.document_no}
                  </td>
                )}
                {vis.has('delivery_number') && (
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
                    {item.delivery_number ?? '—'}
                  </td>
                )}
                {vis.has('pipeline_status') && (
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(item.status)}`}
                    >
                      {pipelineStatusLabel(item)}
                    </span>
                  </td>
                )}
                {vis.has('doc_status') && (
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300" onClick={(e) => e.stopPropagation()}>
                    {docStatusLabel(item.document_status)}
                  </td>
                )}
                {vis.has('change_status') && (
                  <>
                    {item.order_id ? (
                      <OrderWmsStatusCell
                        orderId={item.order_id}
                        orderNumber={item.order_number ?? item.document_no}
                        status={item.order_wms_status ?? 'imported'}
                        canEdit={isWarehouseAdmin && !archive}
                        onAfterSave={() => load({ background: true })}
                      />
                    ) : (
                      <td className="px-4 py-3 text-slate-400 dark:text-slate-600" onClick={(e) => e.stopPropagation()}>
                        —
                      </td>
                    )}
                  </>
                )}
                {vis.has('total_lines') && (
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {item.picked_lines}/{item.total_lines}
                  </td>
                )}
                {vis.has('picker') && (
                  <td
                    className="max-w-[160px] truncate px-4 py-3 text-slate-600 dark:text-slate-300"
                    title={item.picker_name ?? ''}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex flex-col gap-1">
                      <span>{item.picker_name ?? '—'}</span>
                      {!archive && canReassignPickerRow(item) ? (
                        <button
                          type="button"
                          className="text-left text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                          onClick={() => {
                            setReassignDialogOrderIds([item.order_id as string])
                          }}
                        >
                          {t('orders:reassign_picker.button')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                )}
                {vis.has('controller') && (
                  <td className="max-w-[140px] truncate px-4 py-3 text-slate-600 dark:text-slate-300" title={item.controller_name ?? ''}>
                    {item.controller_name ?? '—'}
                  </td>
                )}
                {vis.has('last_activity') && (
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
                    {formatActivity(item.updated_at, i18n.language)}
                  </td>
                )}
                {vis.has('view') && (
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation()
                        navigate(`/picking/mobile-pwa/${item.id}`)
                      }}
                    >
                      <FileText size={18} />
                    </Button>
                  </td>
                )}
                {canCancel && !archive && vis.has('cancel') && (
                  <td className="px-4 py-3">
                    <Button
                      variant="outline"
                      className="h-8 border-red-200 px-2 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation()
                        void handleCancel(item)
                      }}
                      disabled={cancellingId === item.id}
                    >
                      <XCircle size={14} className="mr-1" />
                      {cancellingId === item.id ? t('picking:cancelling') : t('picking:cancel_document')}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [
    archive,
    canCancel,
    canReassignPickerRow,
    cancellingId,
    docStatusLabel,
    isWarehouseAdmin,
    pipelineStatusLabel,
    error,
    filtered,
    handleCancel,
    query,
    tableRows,
    i18n.language,
    isLoading,
    items.length,
    load,
    navigate,
    t,
    vis,
  ])

  return (
    <AdminLayout titleSlot={<OrdersHubTabs />}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('picking:list_title')}
            {isRefreshing && (
              <span className="ml-2 inline-flex rounded-full bg-blue-100 px-2 py-0.5 align-middle text-xs font-normal text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                {t('picking:refresh')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="w-full max-w-[220px] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              placeholder={t('picking:search_input_placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="relative" ref={filterPanelRef}>
              <Button
                variant="outline"
                className="relative gap-1.5"
                onClick={() => setFilterPanelOpen((o) => !o)}
                aria-label={t('picking:filter_btn')}
                aria-expanded={filterPanelOpen}
              >
                <Filter size={18} />
                {activeFilterCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
              {filterPanelOpen && (
                <>
                  <div className="fixed inset-0 z-40" aria-hidden onClick={() => setFilterPanelOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-2 w-full min-w-[280px] max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('picking:filter_title')}</span>
                      <button
                        type="button"
                        onClick={() => setFilterPanelOpen(false)}
                        className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:text-slate-400 dark:hover:bg-slate-800"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="space-y-3">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        {t('picking:filter_pipeline_status')}
                        <select
                          value={filterStatus}
                          onChange={(e) => setFilterStatus(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          <option value="">{t('picking:filter_all')}</option>
                          {uniqueStatuses.map((s) => (
                            <option key={s} value={s}>{t(`picking:status.${s.toLowerCase()}`, { defaultValue: s })}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        {t('picking:filter_doc_status')}
                        <select
                          value={filterDocStatus}
                          onChange={(e) => setFilterDocStatus(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          <option value="">{t('picking:filter_all')}</option>
                          {uniqueDocStatuses.map((s) => (
                            <option key={s} value={s}>{docStatusLabel(s)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        {t('picking:filter_picker')}
                        <select
                          value={filterPicker}
                          onChange={(e) => setFilterPicker(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          <option value="">{t('picking:filter_all')}</option>
                          {uniquePickers.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        {t('picking:filter_controller')}
                        <select
                          value={filterController}
                          onChange={(e) => setFilterController(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          <option value="">{t('picking:filter_all')}</option>
                          {uniqueControllers.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="mt-4 flex items-center justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setFilterStatus('')
                          setFilterDocStatus('')
                          setFilterPicker('')
                          setFilterController('')
                          setFilterPanelOpen(false)
                        }}
                      >
                        {t('picking:filter_clear')}
                      </Button>
                      <Button onClick={() => setFilterPanelOpen(false)}>
                        {t('picking:filter_apply')}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              className="rounded-full px-3 py-3"
              onClick={() => setIsSettingsOpen(true)}
              aria-label={t('orders:table.settings_title')}
            >
              <Settings size={18} />
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                nextOffsetRef.current = 0
                void load({ background: true })
              }}
              disabled={isRefreshing}
            >
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
              {t('common:buttons.refresh')}
            </Button>
          </div>
        </div>

        <div className="max-h-[calc(100vh-320px)] min-h-0 overflow-auto">{content}</div>

        {hasMore && !isLoading && items.length > 0 && (
          <div className="flex justify-center pb-2">
            <Button variant="secondary" onClick={() => void load({ append: true })} disabled={loadingMore}>
              {loadingMore ? t('common:messages.loading') : t('picking:load_more')}
            </Button>
          </div>
        )}

        <OrdersTableSettings
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          config={{ ...tableConfig, searchFields: [] }}
          columns={PICKLISTS_COLUMN_IDS.map((id) => ({
            id,
            label: t(PICKLISTS_COLUMN_LABEL_KEYS[id] ?? id),
          }))}
          searchFields={[]}
          onSave={(next) => updateTableConfig({ visibleColumns: next.visibleColumns, columnOrder: next.columnOrder })}
          onReset={resetTableConfig}
        />

        {reassignDialogOrderIds !== null ? (
          <SendToPickingDialog
            mode="reassign"
            open
            orderIds={reassignDialogOrderIds}
            onOpenChange={(open) => !open && setReassignDialogOrderIds(null)}
            onSent={() => {
              setReassignDialogOrderIds(null)
              void load({ background: true })
            }}
          />
        ) : null}
      </Card>
    </AdminLayout>
  )
}
