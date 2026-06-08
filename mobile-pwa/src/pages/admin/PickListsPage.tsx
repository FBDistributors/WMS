import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Filter, RefreshCw, Settings, X, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { OrdersHubTabs } from '../../admin/components/orders/OrdersHubTabs'
import { OrdersTableSettings } from '../../admin/components/orders/OrdersTableSettings'
import { SendToPickingDialog } from '../../admin/components/orders/SendToPickingDialog'
import { ReassignControllerDialog } from '../../admin/components/orders/ReassignControllerDialog'
import { usePickListsTableConfig, PICKLISTS_COLUMN_IDS } from '../../admin/hooks/usePickListsTableConfig'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { TableScrollArea } from '../../components/TableScrollArea'
import { listPickLists, cancelPickList, type PickList, type PickListStatus, type ListPickListsOptions } from '../../services/pickingApi'
import { updateOrderStatus } from '../../services/ordersApi'
import { useAppToast } from '../../feedback/useAppToast'
import { useAuth } from '../../rbac/AuthProvider'

const PAGE_SIZE = 200

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
  customer_id: 'picking:column_customer_id',
  customer_name: 'picking:column_customer_name',
  pipeline_status: 'picking:status_label',
  doc_status: 'orders:columns.so_document_status',
  total_lines: 'picking:total_lines',
  picker: 'picking:column_picker',
  controller: 'picking:column_controller',
  last_activity: 'picking:last_activity',
  sent_to_picker_at: 'picking:column_sent_to_picker',
  picker_reassigned_at: 'picking:column_picker_reassigned',
  cancelled_at: 'picking:column_cancelled_at',
  cancelled_by: 'picking:column_cancelled_by',
  view: 'picking:details_title',
  cancel: 'picking:cancel_document',
}

export function PickListsPage() {
  const { t, i18n } = useTranslation(['picking', 'common', 'orders'])
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const [searchParams] = useSearchParams()
  const archive = pathname.endsWith('/picking/archive')
  const cancelled = pathname.endsWith('/picking/cancelled')
  const { has } = useAuth()
  const tableScope = cancelled ? 'cancelled' : archive ? 'archive' : 'active'
  const { config: tableConfig, updateConfig: updateTableConfig, resetConfig: resetTableConfig } =
    usePickListsTableConfig(tableScope)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

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
  const { showError } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<PickList | null>(null)
  const [reassignDialogOrderIds, setReassignDialogOrderIds] = useState<string[] | null>(null)
  const [reassignControllerDialogOrderIds, setReassignControllerDialogOrderIds] = useState<
    string[] | null
  >(null)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDocStatus, setFilterDocStatus] = useState('')
  const [filterPicker, setFilterPicker] = useState('')
  const [filterController, setFilterController] = useState('')

  /** Keyingi sahifa uchun offset (yuklangan qatorlar soni) */
  const nextOffsetRef = useRef(0)

  const canCancel = has('documents:edit_status')
  const orderedPickTableColumns = useMemo(() => {
    const rawOrder = tableConfig.columnOrder.filter((id) => PICKLISTS_COLUMN_IDS.includes(id))
    const mergedOrder =
      rawOrder.length > 0
        ? [...rawOrder, ...PICKLISTS_COLUMN_IDS.filter((id) => !rawOrder.includes(id))]
        : [...PICKLISTS_COLUMN_IDS]
    const visible = new Set(tableConfig.visibleColumns)
    return mergedOrder.filter((id) => {
      if (!visible.has(id)) return false
      if (id === 'cancel' && (!canCancel || cancelled || archive)) return false
      return true
    })
  }, [tableConfig.columnOrder, tableConfig.visibleColumns, cancelled, archive, canCancel])
  const canReassignPickerRow = useCallback(
    (item: PickList) =>
      Boolean(item.order_id) && has('orders:write') && item.order_wms_status === 'allocated',
    [has]
  )
  const canReassignControllerRow = useCallback(
    (item: PickList) =>
      Boolean(item.order_id) &&
      has('documents:edit_status') &&
      item.document_status === 'picked' &&
      Boolean(item.controller_name) &&
      !item.controller_verification_started_at,
    [has]
  )

  const openPickDetail = useCallback(
    (item: PickList) => {
      navigate(`/admin/picking/${item.id}`, { state: { backTo: `${pathname}${search}` } })
    },
    [navigate, pathname, search]
  )

  const load = useCallback(
    async (opts: { background?: boolean; append?: boolean } = {}) => {
      const { background = false, append = false } = opts
      if (!background && !append) {
        setIsLoading(true)
        setHasLoadError(false)
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
          if (!background) {
            showError(t('picking:load_error'))
            setHasLoadError(true)
          }
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
    [processScope, showError, t, wmsGroupForApi]
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
          item.customer_id ?? '',
          item.customer_name ?? '',
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

  const tableRows = filtered

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

  const confirmCancel = useCallback(
    async () => {
      if (!cancelTarget) return
      const item = cancelTarget
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
        showError(t('picking:cancel_error'))
      } finally {
        setCancellingId(null)
        setCancelTarget(null)
      }
    },
    [cancelTarget, load, showError, t]
  )

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="relative flex-1 min-h-[200px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
    }
    if (hasLoadError) {
      return (
        <EmptyState
          title={t('picking:load_error')}
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
    const pickHeader = (colId: string): React.ReactNode => {
      switch (colId) {
        case 'document_no':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:document_label')}
            </th>
          )
        case 'delivery_number':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:column_delivery_number')}
            </th>
          )
        case 'customer_id':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:column_customer_id')}
            </th>
          )
        case 'customer_name':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:column_customer_name')}
            </th>
          )
        case 'pipeline_status':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:status_label')}
            </th>
          )
        case 'doc_status':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('orders:columns.so_document_status')}
            </th>
          )
        case 'total_lines':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:total_lines')}
            </th>
          )
        case 'picker':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:column_picker')}
            </th>
          )
        case 'controller':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:column_controller')}
            </th>
          )
        case 'last_activity':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:last_activity')}
            </th>
          )
        case 'sent_to_picker_at':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:column_sent_to_picker')}
            </th>
          )
        case 'picker_reassigned_at':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:column_picker_reassigned')}
            </th>
          )
        case 'cancelled_at':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:column_cancelled_at')}
            </th>
          )
        case 'cancelled_by':
          return (
            <th key={colId} className="px-4 py-3 text-left">
              {t('picking:column_cancelled_by')}
            </th>
          )
        case 'view':
        case 'cancel':
          return <th key={colId} className="px-4 py-3" />
        default:
          return null
      }
    }

    const pickCell = (colId: string, item: PickList): React.ReactNode => {
      switch (colId) {
        case 'document_no':
          return (
            <td key={colId} className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
              {item.order_number?.trim() ? item.order_number.trim() : item.document_no}
            </td>
          )
        case 'delivery_number':
          return (
            <td key={colId} className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
              {item.delivery_number ?? '—'}
            </td>
          )
        case 'customer_id':
          return (
            <td
              key={colId}
              className="max-w-[120px] truncate px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300"
              title={item.customer_id ?? ''}
            >
              {item.customer_id?.trim() ? item.customer_id.trim() : '—'}
            </td>
          )
        case 'customer_name':
          return (
            <td
              key={colId}
              className="max-w-[200px] truncate px-4 py-3 text-slate-700 dark:text-slate-200"
              title={item.customer_name ?? ''}
            >
              {item.customer_name?.trim() ? item.customer_name.trim() : '—'}
            </td>
          )
        case 'pipeline_status':
          return (
            <td key={colId} className="px-4 py-3">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(item.status)}`}
              >
                {pipelineStatusLabel(item)}
              </span>
            </td>
          )
        case 'doc_status':
          return (
            <td key={colId} className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {docStatusLabel(item.document_status)}
            </td>
          )
        case 'total_lines':
          return (
            <td key={colId} className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {item.picked_lines}/{item.total_lines}
            </td>
          )
        case 'picker':
          return (
            <td
              key={colId}
              className="max-w-[160px] truncate px-4 py-3 text-slate-600 dark:text-slate-300"
              title={item.picker_name ?? ''}
            >
              <div className="flex flex-col gap-1">
                <span>{item.picker_name ?? '—'}</span>
                {!archive && canReassignPickerRow(item) ? (
                  <button
                    type="button"
                    className="text-left text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                    onClick={(e) => {
                      e.stopPropagation()
                      setReassignDialogOrderIds([item.order_id as string])
                    }}
                  >
                    {t('orders:reassign_picker.button')}
                  </button>
                ) : null}
              </div>
            </td>
          )
        case 'controller':
          return (
            <td
              key={colId}
              className="max-w-[140px] truncate px-4 py-3 text-slate-600 dark:text-slate-300"
              title={item.controller_name ?? ''}
            >
              <div className="flex flex-col gap-1">
                <span>{item.controller_name ?? '—'}</span>
                {!archive && canReassignControllerRow(item) ? (
                  <button
                    type="button"
                    className="text-left text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                    onClick={(e) => {
                      e.stopPropagation()
                      setReassignControllerDialogOrderIds([item.order_id as string])
                    }}
                  >
                    {t('orders:reassign_controller.button')}
                  </button>
                ) : null}
              </div>
            </td>
          )
        case 'last_activity':
          return (
            <td key={colId} className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
              {formatActivity(
                cancelled ? item.cancelled_at ?? item.updated_at : item.updated_at,
                i18n.language,
              )}
            </td>
          )
        case 'sent_to_picker_at':
          return (
            <td key={colId} className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
              {formatActivity(item.first_assigned_at ?? undefined, i18n.language)}
            </td>
          )
        case 'picker_reassigned_at':
          return (
            <td key={colId} className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
              {formatActivity(item.last_assigned_at ?? undefined, i18n.language)}
            </td>
          )
        case 'cancelled_at':
          return (
            <td key={colId} className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
              {formatActivity(item.cancelled_at ?? undefined, i18n.language)}
            </td>
          )
        case 'cancelled_by':
          return (
            <td
              key={colId}
              className="max-w-[160px] truncate px-4 py-3 text-slate-600 dark:text-slate-300"
              title={item.cancelled_by_name ?? ''}
            >
              {item.cancelled_by_name ?? '—'}
            </td>
          )
        case 'view':
          return (
            <td key={colId} className="px-4 py-3">
              <Button
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation()
                  openPickDetail(item)
                }}
              >
                <FileText size={18} />
              </Button>
            </td>
          )
        case 'cancel':
          return (
            <td key={colId} className="px-4 py-3">
              <Button
                variant="outline"
                className="h-8 border-red-200 bg-red-50 px-2 text-xs text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-900/40"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation()
                  setCancelTarget(item)
                }}
                disabled={cancellingId === item.id}
              >
                <XCircle size={14} className="mr-1" />
                {cancellingId === item.id ? t('picking:cancelling') : t('picking:cancel_document')}
              </Button>
            </td>
          )
        default:
          return null
      }
    }

    return (
      <TableScrollArea inline>
        <table className="w-max min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {orderedPickTableColumns.map((colId) => pickHeader(colId))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                onClick={() => openPickDetail(item)}
              >
                {orderedPickTableColumns.map((colId) => pickCell(colId, item))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [
    archive,
    canCancel,
    cancelled,
    canReassignPickerRow,
    canReassignControllerRow,
    cancellingId,
    docStatusLabel,
    pipelineStatusLabel,
    hasLoadError,
    filtered,
    query,
    i18n.language,
    isLoading,
    items.length,
    load,
    openPickDetail,
    orderedPickTableColumns,
    t,
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

        <div className="min-h-[calc(100vh-320px)] overflow-auto">{content}</div>

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

        <ConfirmDialog
          open={cancelTarget !== null}
          title={t('picking:cancel_confirm_title')}
          message={t('picking:cancel_confirm', { doc: cancelTarget?.document_no ?? '' })}
          confirmLabel={t('picking:cancel_document')}
          cancelLabel={t('common:buttons.cancel')}
          variant="danger"
          loading={cancellingId !== null}
          onConfirm={confirmCancel}
          onCancel={() => setCancelTarget(null)}
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

        {reassignControllerDialogOrderIds !== null ? (
          <ReassignControllerDialog
            open
            orderIds={reassignControllerDialogOrderIds}
            onOpenChange={(open) => !open && setReassignControllerDialogOrderIds(null)}
            onReassigned={() => {
              setReassignControllerDialogOrderIds(null)
              void load({ background: true })
            }}
          />
        ) : null}
      </Card>
    </AdminLayout>
  )
}
