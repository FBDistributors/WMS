import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { FileText, Filter, MinusCircle, RefreshCw, Search, X } from 'lucide-react'

import { useAuth } from '../../rbac/AuthProvider'
import { AdminDataTable, type AdminDataTableColumn } from '../../admin/components/AdminDataTable'
import { AdminLayout } from '../../admin/components/AdminLayout'
import { AdminTablePagination } from '../../admin/components/AdminTablePagination'
import { ReceiptListExportToolbar } from '../../admin/components/receiving/ReceiptListExportToolbar'
import type { ExportFormat } from '../../admin/components/receiving/ExportFormatDropdown'
import { DateInput } from '../../components/DateInput'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import { formatUnknownError } from '../../lib/formatUnknownError'
import {
  fetchAllInventoryMovements,
  getInventoryMovements,
  type InventoryMovement,
} from '../../services/inventoryApi'
import {
  buildKamomatListExportLabels,
  buildKamomatListExportRows,
  filterKamomatBySearch,
  KamomatExportTooLargeError,
  runKamomatListExport,
} from '../../utils/kamomatListExport'

const PAGE_SIZE = 50

type KamomatColumnId =
  | 'movement_type'
  | 'qty'
  | 'code'
  | 'barcode'
  | 'product'
  | 'lot'
  | 'location'
  | 'created_by'
  | 'created_at'

const KAMOMAT_COLUMN_IDS: KamomatColumnId[] = [
  'movement_type',
  'qty',
  'code',
  'barcode',
  'product',
  'lot',
  'location',
  'created_by',
  'created_at',
]

function kamomatThWidth(col: KamomatColumnId): string | undefined {
  const widths: Partial<Record<KamomatColumnId, string>> = {
    movement_type: '9rem',
    qty: '4.5rem',
    code: '5.5rem',
    barcode: '9rem',
    product: '14rem',
    lot: '7rem',
    location: '6rem',
    created_by: '8rem',
    created_at: '9rem',
  }
  return widths[col]
}

function movementTypeLabel(row: InventoryMovement, t: TFunction): string {
  if (row.reason_code === 'inventory_overage') {
    return t('admin:movement_page.reason_overage')
  }
  if (row.reason_code === 'inventory_shortage') {
    return t('admin:movement_page.reason_shortage')
  }
  return t(`inventory:movement_types.${row.movement_type}`, row.movement_type)
}

function renderKamomatCell(colId: KamomatColumnId, row: InventoryMovement, t: TFunction): ReactNode {
  switch (colId) {
    case 'movement_type':
      return (
        <span className="block truncate" title={movementTypeLabel(row, t)}>
          {movementTypeLabel(row, t)}
        </span>
      )
    case 'qty': {
      const n = Math.round(Number(row.qty_change))
      const text = n > 0 ? `+${n}` : String(n)
      return <span className="tabular-nums">{text}</span>
    }
    case 'code':
      return <span className="whitespace-nowrap">{row.product_code ?? '—'}</span>
    case 'barcode':
      return (
        <span className="block truncate font-mono text-xs" title={row.product_barcode ?? undefined}>
          {row.product_barcode ?? '—'}
        </span>
      )
    case 'product':
      return (
        <span className="line-clamp-2 text-sm leading-snug" title={row.product_name ?? undefined}>
          {row.product_name ?? row.product_id}
        </span>
      )
    case 'lot':
      return (
        <span className="block truncate font-mono text-xs" title={String(row.batch ?? row.lot_id)}>
          {row.batch ?? row.lot_id}
        </span>
      )
    case 'location':
      return <span className="whitespace-nowrap">{row.location_code ?? row.location_id}</span>
    case 'created_by':
      return (
        <span className="block truncate" title={row.created_by_username ?? undefined}>
          {row.created_by_username ?? row.created_by_user_id ?? '—'}
        </span>
      )
    case 'created_at':
      return <span className="whitespace-nowrap text-xs">{new Date(row.created_at).toLocaleString()}</span>
    default:
      return '—'
  }
}

/** Inventarizatsiya (Hujjatlar tarixi): barcha ombor harakatlari — standart admin jadvali. */
export function KamomatlarPage() {
  const { t } = useTranslation(['kamomat', 'common', 'admin', 'inventory'])
  const { has } = useAuth()
  const canWriteOff = has('inventory:adjust')
  const [items, setItems] = useState<InventoryMovement[]>([])
  const [offset, setOffset] = useState(0)
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { showError, showSuccess, showInfo } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)
  const [detailRow, setDetailRow] = useState<InventoryMovement | null>(null)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const hasLoadedOnceRef = useRef(false)

  const load = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setIsLoading(true)
    else setIsRefreshing(true)
    setHasLoadError(false)
    try {
      const data = await getInventoryMovements({
        date_from: filterDateFrom.trim() || undefined,
        date_to: filterDateTo.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setItems(data)
      hasLoadedOnceRef.current = true
    } catch (err) {
      showError(err instanceof Error ? err.message : t('kamomat:load_error'))
      setHasLoadError(true)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [filterDateFrom, filterDateTo, offset, showError, t])

  useEffect(() => {
    void load()
  }, [load])

  const handleRefresh = useCallback(() => {
    void load()
  }, [load])

  const filteredItems = useMemo(() => {
    return filterKamomatBySearch(items, searchQuery)
  }, [items, searchQuery])

  const showInitialLoading = isLoading && !hasLoadedOnceRef.current

  const buildExportFilterSummary = useCallback((): string[] => {
    const parts: string[] = []
    if (filterDateFrom.trim() || filterDateTo.trim()) {
      parts.push(
        `${t('kamomat:export.filter_date')}: ${filterDateFrom.trim() || '…'} – ${filterDateTo.trim() || '…'}`
      )
    }
    if (searchQuery.trim()) {
      parts.push(`${t('kamomat:export.filter_search')}: ${searchQuery.trim()}`)
    }
    if (parts.length === 0) {
      parts.push(t('kamomat:export.filter_none'))
    }
    return parts
  }, [t, filterDateFrom, filterDateTo, searchQuery])

  const handleListExport = useCallback(
    async (kind: ExportFormat) => {
      showInfo(t('kamomat:export.fetching'), 4000)
      try {
        const all = await fetchAllInventoryMovements({
          date_from: filterDateFrom.trim() || undefined,
          date_to: filterDateTo.trim() || undefined,
        })
        const filtered = filterKamomatBySearch(all, searchQuery)
        if (filtered.length === 0) {
          throw new Error(t('admin:movement_page.search_no_results'))
        }
        const rows = buildKamomatListExportRows(filtered, t)
        const ctx = {
          title: t('kamomat:export.list_title'),
          filterSummaryLines: buildExportFilterSummary(),
          rows,
          labels: buildKamomatListExportLabels(t),
        }
        await runKamomatListExport(kind, ctx)
        showSuccess(t('kamomat:export.success'))
      } catch (err) {
        if (err instanceof KamomatExportTooLargeError) {
          showError(t('kamomat:export.too_large'))
        } else {
          showError(`${t('kamomat:export.failed')}: ${formatUnknownError(err)}`)
        }
        throw err
      }
    },
    [t, filterDateFrom, filterDateTo, searchQuery, buildExportFilterSummary, showInfo, showSuccess, showError]
  )

  const columnLabels = useMemo(
    (): Record<KamomatColumnId, string> => ({
      movement_type: t('inventory:columns.movement_type'),
      qty: t('inventory:columns.qty'),
      code: t('inventory:columns.code'),
      barcode: t('inventory:columns.barcode'),
      product: t('inventory:columns.product'),
      lot: t('inventory:columns.lot'),
      location: t('inventory:columns.location'),
      created_by: t('inventory:columns.created_by'),
      created_at: t('inventory:columns.created_at'),
    }),
    [t]
  )

  const tableColumns = useMemo((): AdminDataTableColumn<InventoryMovement>[] => {
    return KAMOMAT_COLUMN_IDS.map((colId) => ({
      id: colId,
      header: columnLabels[colId],
      width: kamomatThWidth(colId),
      align: colId === 'qty' ? 'right' : 'left',
      cell: (row) => renderKamomatCell(colId, row, t),
    }))
  }, [columnLabels, t])

  const hasNextPage = items.length >= PAGE_SIZE
  const pageEnd = offset + items.length

  const tableBody = () => {
    if (showInitialLoading) {
      return (
        <div className="relative flex-1 min-h-[200px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
    }
    if (hasLoadError) {
      return (
        <EmptyState
          title={t('kamomat:load_error')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      )
    }
    if (items.length === 0) {
      return (
        <EmptyState
          icon={<FileText size={32} />}
          title={t('kamomat:empty')}
          description={t('kamomat:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    if (filteredItems.length === 0) {
      return (
        <EmptyState
          title={t('admin:movement_page.search_no_results')}
          description={t('receiving:no_results_desc')}
        />
      )
    }
    return (
      <AdminDataTable
        columns={tableColumns}
        rows={filteredItems}
        getRowKey={(row) => row.id}
        minWidth="min-w-[72rem]"
        onRowClick={setDetailRow}
        refreshing={isRefreshing}
        refreshingLabel={t('common:messages.loading')}
      />
    )
  }

  return (
    <AdminLayout title={t('kamomat:title')}>
      {canWriteOff && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link
            to="/admin/kamomat/yoq-qilish"
            className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-900/50"
          >
            <MinusCircle size={18} />
            {t('kamomat:write_off_button')}
          </Link>
        </div>
      )}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="relative min-w-[180px] flex-1 max-w-md">
            <Search
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('admin:movement_page.search_placeholder')}
              aria-label={t('admin:movement_page.search_placeholder')}
            />
          </div>
          <div className="relative" ref={filterPanelRef}>
            <Button
              variant="outline"
              onClick={() => setFilterPanelOpen((o) => !o)}
              className="gap-2"
              aria-label={t('admin:movement_page.filter_btn')}
              aria-expanded={filterPanelOpen}
            >
              <Filter size={18} />
              {t('admin:movement_page.filter_btn')}
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
                      {t('admin:movement_page.filter_by_date')}
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
                        setFilterDateFrom('')
                        setFilterDateTo('')
                        setOffset(0)
                        setFilterPanelOpen(false)
                      }}
                    >
                      {t('orders:filters.filter_clear')}
                    </Button>
                    <Button
                      onClick={() => {
                        setOffset(0)
                        setFilterPanelOpen(false)
                        void load()
                      }}
                    >
                      {t('inventory:filters.apply')}
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
            disabled={showInitialLoading || items.length === 0}
            onExport={async (kind) => {
              try {
                await handleListExport(kind)
              } catch {
                /* toast in handleListExport */
              }
            }}
          />
        </div>
        {tableBody()}
        {!showInitialLoading && items.length > 0 ? (
          <AdminTablePagination
            offset={offset}
            pageSize={PAGE_SIZE}
            to={pageEnd}
            rangeSuffix={hasNextPage ? '+' : ''}
            onPrev={() => setOffset((p) => Math.max(0, p - PAGE_SIZE))}
            onNext={() => setOffset((p) => p + PAGE_SIZE)}
            nextDisabled={!hasNextPage}
          />
        ) : null}
      </Card>

      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setDetailRow(null)}
            aria-label={t('common:buttons.close')}
          />
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('kamomat:detail.summary')} • {detailRow.id.slice(0, 8)}
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {t('kamomat:detail.product_code')}:
                </span>
                <span className="text-slate-800 dark:text-slate-200">
                  {detailRow.product_code ?? '—'}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {t('kamomat:detail.barcode')}:
                </span>
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {detailRow.product_barcode ?? '—'}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {t('inventory:columns.product')}:
                </span>
                <span className="text-slate-800 dark:text-slate-200">
                  {detailRow.product_name ?? detailRow.product_id}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.batch')}:</span>
                <span className="text-slate-800 dark:text-slate-200">{detailRow.batch ?? detailRow.lot_id}</span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.location')}:</span>
                <span className="text-slate-800 dark:text-slate-200">
                  {detailRow.location_code ?? detailRow.location_id}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.qty_change')}:</span>
                <span
                  className={
                    Number(detailRow.qty_change) < 0
                      ? 'font-medium text-amber-600 dark:text-amber-400'
                      : 'text-slate-800 dark:text-slate-200'
                  }
                >
                  {Number(detailRow.qty_change) > 0 ? '+' : ''}
                  {Math.round(Number(detailRow.qty_change))}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.action_type')}:</span>
                <span className="text-slate-800 dark:text-slate-200">{movementTypeLabel(detailRow, t)}</span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.who')}:</span>
                <span className="text-slate-800 dark:text-slate-200">
                  {detailRow.created_by_username ?? detailRow.created_by_user_id ?? '—'}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.when')}:</span>
                <span className="text-slate-800 dark:text-slate-200">
                  {new Date(detailRow.created_at).toLocaleString()}
                </span>
              </div>
            </dl>
            <Button className="mt-4" variant="secondary" onClick={() => setDetailRow(null)}>
              {t('common:buttons.close')}
            </Button>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
