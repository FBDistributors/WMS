import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ClipboardList, Filter, RefreshCw, Search, X } from 'lucide-react'

import { AdminDataTable, type AdminDataTableColumn } from '../../admin/components/AdminDataTable'
import { AdminLayout } from '../../admin/components/AdminLayout'
import { AdminTablePagination } from '../../admin/components/AdminTablePagination'
import { ReceiptListExportToolbar } from '../../admin/components/receiving/ReceiptListExportToolbar'
import type { ExportFormat } from '../../admin/components/receiving/ExportFormatDropdown'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { DateInput } from '../../components/DateInput'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import { formatUnknownError } from '../../lib/formatUnknownError'
import {
  CustomerReturnsExportTooLargeError,
  fetchAllCustomerReturns,
  getCustomerReturnsHistory,
  type CustomerReturnOut,
} from '../../services/ordersApi'
import {
  buildReturnsHistoryExportLabels,
  buildReturnsHistoryExportRows,
  formatReturnsDateTime,
  returnStatusLabel,
  runReturnsHistoryExport,
} from '../../utils/returnsHistoryExport'

const PAGE_SIZE = 50

const RETURN_STATUS_VALUES = [
  'pending_controller',
  'approved',
  'assigned_to_picker',
  'completed',
  'cancelled',
] as const

function returnsThWidth(col: string): string | undefined {
  const widths: Record<string, string> = {
    doc_no: '11rem',
    customer: '14rem',
    status: '9rem',
    controller: '10rem',
    picker: '10rem',
    assigned_at: '9rem',
    created_at: '9rem',
    updated_at: '9rem',
  }
  return widths[col]
}

function getReturnId(item: CustomerReturnOut): string {
  const fallback = (item as CustomerReturnOut & { return_id?: string }).return_id
  return String(item.id ?? fallback ?? '').trim()
}

export function ReturnsHistoryPage() {
  const { t } = useTranslation(['admin', 'common', 'receiving', 'orders', 'inventory'])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { showError, showSuccess, showInfo } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)
  const [rows, setRows] = useState<CustomerReturnOut[]>([])
  const [total, setTotal] = useState(0)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const hasLoadedOnceRef = useRef(false)

  const q = searchParams.get('q') ?? ''
  const status = searchParams.get('status') ?? ''
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10))

  const [filterStatus, setFilterStatus] = useState(status)
  const [filterDateFrom, setFilterDateFrom] = useState(dateFrom)
  const [filterDateTo, setFilterDateTo] = useState(dateTo)

  useEffect(() => {
    setFilterStatus(status)
    setFilterDateFrom(dateFrom)
    setFilterDateTo(dateTo)
  }, [status, dateFrom, dateTo])

  const load = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setIsLoading(true)
    else setIsRefreshing(true)
    setHasLoadError(false)
    try {
      const data = await getCustomerReturnsHistory({
        q: q.trim() || undefined,
        status: status.trim() || undefined,
        date_from: dateFrom.trim() || undefined,
        date_to: dateTo.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setRows(data.items)
      setTotal(data.total)
      hasLoadedOnceRef.current = true
    } catch (err) {
      showError(err instanceof Error ? err.message : t('admin:returns_history.load_error'))
      setHasLoadError(true)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [dateFrom, dateTo, offset, q, showError, status, t])

  useEffect(() => {
    void load()
  }, [load])

  const handleRefresh = useCallback(() => {
    void load()
  }, [load])

  const statusOptions = useMemo(
    () =>
      RETURN_STATUS_VALUES.map((value) => ({
        value,
        label: returnStatusLabel(value, t),
      })),
    [t]
  )

  const buildExportFilterSummary = useCallback((): string[] => {
    const parts: string[] = []
    if (dateFrom.trim() || dateTo.trim()) {
      parts.push(
        `${t('admin:returns_history.export_filter_date')}: ${dateFrom.trim() || '…'} – ${dateTo.trim() || '…'}`
      )
    }
    if (status.trim()) {
      parts.push(
        `${t('admin:returns_history.export_filter_status')}: ${returnStatusLabel(status, t)}`
      )
    }
    if (q.trim()) {
      parts.push(`${t('admin:returns_history.export_filter_search')}: ${q.trim()}`)
    }
    if (parts.length === 0) {
      parts.push(t('admin:returns_history.export_filter_none'))
    }
    return parts
  }, [dateFrom, dateTo, q, status, t])

  const handleListExport = useCallback(
    async (kind: ExportFormat) => {
      showInfo(t('admin:returns_history.export_fetching'), 4000)
      try {
        const all = await fetchAllCustomerReturns({
          q: q.trim() || undefined,
          status: status.trim() || undefined,
          date_from: dateFrom.trim() || undefined,
          date_to: dateTo.trim() || undefined,
        })
        if (all.length === 0) {
          throw new Error(t('admin:returns_history.empty_title'))
        }
        const ctx = {
          title: t('admin:returns_history.export_list_title'),
          filterSummaryLines: buildExportFilterSummary(),
          rows: buildReturnsHistoryExportRows(all, t),
          labels: buildReturnsHistoryExportLabels(t),
        }
        await runReturnsHistoryExport(kind, ctx)
        showSuccess(t('admin:returns_history.export_success'))
      } catch (err) {
        if (err instanceof CustomerReturnsExportTooLargeError) {
          showError(t('admin:returns_history.export_too_large'))
        } else {
          showError(`${t('admin:returns_history.export_failed')}: ${formatUnknownError(err)}`)
        }
        throw err
      }
    },
    [buildExportFilterSummary, dateFrom, dateTo, q, showError, showInfo, showSuccess, status, t]
  )

  const tableColumns = useMemo((): AdminDataTableColumn<CustomerReturnOut>[] => {
    const cols: Array<{ id: string; header: string; cell: (row: CustomerReturnOut) => ReactNode }> = [
      {
        id: 'doc_no',
        header: t('admin:returns_history.columns.doc_no'),
        cell: (row) => (
          <span className="block truncate font-semibold text-blue-700 dark:text-blue-300" title={row.doc_no}>
            {row.doc_no}
          </span>
        ),
      },
      {
        id: 'customer',
        header: t('admin:returns_history.columns.customer'),
        cell: (row) => (
          <span className="block truncate" title={row.customer_name ?? row.customer_id ?? undefined}>
            {row.customer_name || row.customer_id || '—'}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('admin:returns_history.columns.status'),
        cell: (row) => (
          <span className="block truncate" title={returnStatusLabel(row.status, t)}>
            {returnStatusLabel(row.status, t)}
          </span>
        ),
      },
      {
        id: 'controller',
        header: t('admin:returns_history.columns.controller'),
        cell: (row) => (
          <span
            className="block truncate"
            title={row.assigned_by_user_name || row.approved_by_user_name || undefined}
          >
            {row.assigned_by_user_name || row.approved_by_user_name || row.assigned_by_user_id || '—'}
          </span>
        ),
      },
      {
        id: 'picker',
        header: t('admin:returns_history.columns.picker'),
        cell: (row) => (
          <span className="block truncate" title={row.assigned_picker_user_name ?? undefined}>
            {row.assigned_picker_user_name || row.assigned_picker_user_id || '—'}
          </span>
        ),
      },
      {
        id: 'assigned_at',
        header: t('admin:returns_history.columns.assigned_at'),
        cell: (row) => (
          <span className="whitespace-nowrap text-xs">{formatReturnsDateTime(row.assigned_at)}</span>
        ),
      },
      {
        id: 'created_at',
        header: t('admin:returns_history.columns.created_at'),
        cell: (row) => (
          <span className="whitespace-nowrap text-xs">{formatReturnsDateTime(row.created_at)}</span>
        ),
      },
      {
        id: 'updated_at',
        header: t('admin:returns_history.columns.updated_at'),
        cell: (row) => (
          <span className="whitespace-nowrap text-xs">{formatReturnsDateTime(row.updated_at)}</span>
        ),
      },
    ]
    return cols.map((col) => ({
      id: col.id,
      header: col.header,
      width: returnsThWidth(col.id),
      cell: (row) => col.cell(row),
    }))
  }, [t])

  const showInitialLoading = isLoading && !hasLoadedOnceRef.current

  const openReturn = useCallback(
    (item: CustomerReturnOut) => {
      const rowId = getReturnId(item)
      if (!rowId) return
      navigate(`/admin/returns-history/${rowId}`, {
        state: { listQuery: searchParams.toString() },
      })
    },
    [navigate, searchParams]
  )

  const tableBody = () => {
    if (showInitialLoading) {
      return (
        <div className="relative min-h-[240px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
    }
    if (hasLoadError) {
      return (
        <EmptyState
          title={t('admin:returns_history.load_error')}
          actionLabel={t('common:buttons.retry')}
          onAction={() => void load()}
        />
      )
    }
    if (rows.length === 0) {
      return (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title={t('admin:returns_history.empty_title')}
          description={t('admin:returns_history.empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={() => void load()}
        />
      )
    }
    return (
      <AdminDataTable
        columns={tableColumns}
        rows={rows}
        getRowKey={(row) => getReturnId(row) || row.doc_no}
        minWidth="min-w-[72rem]"
        onRowClick={openReturn}
        refreshing={isRefreshing}
        refreshingLabel={t('common:messages.loading')}
      />
    )
  }

  return (
    <AdminLayout
      titleSlot={
        <div className="flex items-center gap-2">
          <ClipboardList size={18} />
          <span className="text-sm font-semibold">{t('admin:menu.returns_history')}</span>
        </div>
      }
    >
      <Card className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-[180px] flex-1 max-w-md">
            <Search
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              value={q}
              onChange={(e) => {
                const value = e.target.value
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  if (value.trim()) next.set('q', value)
                  else next.delete('q')
                  next.delete('offset')
                  return next
                })
              }}
              placeholder={t('admin:returns_history.search_placeholder')}
              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
              aria-label={t('admin:returns_history.search_placeholder')}
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:ml-auto">
            <div className="relative" ref={filterPanelRef}>
              <Button
                variant="outline"
                onClick={() => setFilterPanelOpen((open) => !open)}
                className="gap-2"
                aria-label={t('admin:returns_history.filter_btn')}
                aria-expanded={filterPanelOpen}
              >
                <Filter size={18} />
                {t('admin:returns_history.filter_btn')}
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
                        {t('admin:returns_history.filter_panel_title')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setFilterPanelOpen(false)}
                        className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:text-slate-400 dark:hover:bg-slate-800"
                        aria-label={t('common:buttons.close')}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <div className="space-y-3">
                      <label className="block text-sm text-slate-600 dark:text-slate-400">
                        {t('admin:returns_history.filter_status')}
                        <select
                          value={filterStatus}
                          onChange={(e) => setFilterStatus(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          <option value="">{t('admin:returns_history.filter_all_statuses')}</option>
                          {statusOptions.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm text-slate-600 dark:text-slate-400">
                        {t('inventory:filters.date_from')}
                        <DateInput
                          value={filterDateFrom}
                          onChange={setFilterDateFrom}
                          className="mt-1 w-full"
                          aria-label={t('inventory:filters.date_from')}
                        />
                      </label>
                      <label className="block text-sm text-slate-600 dark:text-slate-400">
                        {t('inventory:filters.date_to')}
                        <DateInput
                          value={filterDateTo}
                          onChange={setFilterDateTo}
                          className="mt-1 w-full"
                          aria-label={t('inventory:filters.date_to')}
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setFilterStatus('')
                          setFilterDateFrom('')
                          setFilterDateTo('')
                          setSearchParams((prev) => {
                            const next = new URLSearchParams(prev)
                            next.delete('status')
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
                            const st = filterStatus.trim()
                            const df = filterDateFrom.trim()
                            const dt = filterDateTo.trim()
                            if (st) next.set('status', st)
                            else next.delete('status')
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
                        {t('receiving:filter_apply')}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <Button
              variant="secondary"
              className="h-10 gap-1.5 rounded-xl px-3"
              onClick={handleRefresh}
              disabled={isRefreshing || showInitialLoading}
            >
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin shrink-0' : 'shrink-0'} />
              {t('common:buttons.refresh')}
            </Button>
            <ReceiptListExportToolbar
              disabled={showInitialLoading || total === 0}
              onExport={async (kind) => {
                try {
                  await handleListExport(kind)
                } catch {
                  /* toast in handleListExport */
                }
              }}
            />
          </div>
        </div>

        {tableBody()}

        {!showInitialLoading && total > 0 ? (
          <AdminTablePagination
            offset={offset}
            pageSize={PAGE_SIZE}
            total={total}
            onPrev={() =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev)
                next.set('offset', String(Math.max(0, offset - PAGE_SIZE)))
                return next
              })
            }
            onNext={() =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev)
                next.set('offset', String(offset + PAGE_SIZE))
                return next
              })
            }
          />
        ) : null}
      </Card>
    </AdminLayout>
  )
}
