import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Filter, RefreshCw, Search, Settings, X } from 'lucide-react'

import { AdminDataTable, type AdminDataTableColumn } from '../../admin/components/AdminDataTable'
import { AdminLayout } from '../../admin/components/AdminLayout'
import { AdminTablePagination } from '../../admin/components/AdminTablePagination'
import { MovementTableSettings } from '../../admin/components/movement/MovementTableSettings'
import { ReceiptListExportToolbar } from '../../admin/components/receiving/ReceiptListExportToolbar'
import type { ExportFormat } from '../../admin/components/receiving/ExportFormatDropdown'
import {
  useMovementTableConfig,
  MOVEMENT_TABLE_COLUMN_IDS,
  type MovementTableColumnId,
} from '../../admin/hooks/useMovementTableConfig'
import { DateInput } from '../../components/DateInput'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import { formatUnknownError } from '../../lib/formatUnknownError'
import {
  clearWarehouseTransfersClientCache,
  fetchAllWarehouseTransfers,
  getWarehouseTransfers,
  type WarehouseTransfer,
} from '../../services/inventoryApi'
import {
  buildTransferListExportLabels,
  buildTransferListExportRows,
  filterTransfersBySearch,
  runTransferListExport,
  TransferExportTooLargeError,
} from '../../utils/transferListExport'

const PAGE_SIZE = 50

function formatIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function movementThWidth(col: MovementTableColumnId): string | undefined {
  const widths: Partial<Record<MovementTableColumnId, string>> = {
    from: '6rem',
    to: '6rem',
    qty: '4rem',
    code: '5.5rem',
    barcode: '9rem',
    product: '16rem',
    batch: '6rem',
    created_by: '8rem',
    created_at: '9rem',
  }
  return widths[col]
}

function renderMovementCell(colId: MovementTableColumnId, row: WarehouseTransfer): ReactNode {
  switch (colId) {
    case 'from':
      return row.from_location_code ?? row.from_location_id
    case 'to':
      return row.to_location_code ?? row.to_location_id
    case 'qty':
      return Math.round(Number(row.qty))
    case 'code':
      return row.product_code ?? '—'
    case 'barcode':
      return row.product_barcode ?? '—'
    case 'product':
      return (
        <span className="block truncate max-w-[16rem]" title={row.product_name ?? undefined}>
          {row.product_name ?? row.product_id}
        </span>
      )
    case 'batch':
      return row.batch ?? row.lot_id
    case 'created_by':
      return row.created_by_username ?? row.created_by_user_id ?? '—'
    case 'created_at':
      return new Date(row.created_at).toLocaleString()
    default:
      return '—'
  }
}

/** Admin Ko'chirish: joydan-joyga o'tkazmalar jadvali (Qabul uslubi). */
export function MovementPage() {
  const { t } = useTranslation(['admin', 'common', 'inventory', 'kamomat', 'receiving'])
  const [searchParams, setSearchParams] = useSearchParams()
  const searchQuery = searchParams.get('q') ?? ''
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10))

  const [filterDateFrom, setFilterDateFrom] = useState(dateFrom)
  const [filterDateTo, setFilterDateTo] = useState(dateTo)
  const [items, setItems] = useState<WarehouseTransfer[]>([])
  const [totalTransfers, setTotalTransfers] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { showError, showSuccess, showInfo } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)
  const [detailRow, setDetailRow] = useState<WarehouseTransfer | null>(null)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [isTableSettingsOpen, setIsTableSettingsOpen] = useState(false)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const defaultDatesApplied = useRef(false)
  const hasLoadedOnceRef = useRef(false)

  const { config: tableConfig, updateConfig: updateTableConfig, resetConfig: resetTableConfig } =
    useMovementTableConfig()

  useEffect(() => {
    if (defaultDatesApplied.current) return
    if (dateFrom.trim() || dateTo.trim()) {
      defaultDatesApplied.current = true
      return
    }
    defaultDatesApplied.current = true
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - 7)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('date_from', formatIsoDate(from))
        next.set('date_to', formatIsoDate(to))
        return next
      },
      { replace: true }
    )
  }, [dateFrom, dateTo, setSearchParams])

  useEffect(() => {
    if (!filterPanelOpen) return
    setFilterDateFrom(dateFrom)
    setFilterDateTo(dateTo)
  }, [filterPanelOpen, dateFrom, dateTo])

  const load = useCallback(
    async (opts?: { forceRefresh?: boolean }) => {
      if (!hasLoadedOnceRef.current) setIsLoading(true)
      else setIsRefreshing(true)
      setHasLoadError(false)
      try {
        const { items: pageItems, total } = await getWarehouseTransfers(
          {
            date_from: dateFrom.trim() || undefined,
            date_to: dateTo.trim() || undefined,
            limit: PAGE_SIZE,
            offset,
          },
          { forceRefresh: opts?.forceRefresh }
        )
        setItems(pageItems)
        setTotalTransfers(total)
        hasLoadedOnceRef.current = true
      } catch (err) {
        showError(err instanceof Error ? err.message : t('inventory:load_failed'))
        setHasLoadError(true)
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    [dateFrom, dateTo, offset, showError, t]
  )

  useEffect(() => {
    void load()
  }, [load])

  const handleRefresh = useCallback(() => {
    clearWarehouseTransfersClientCache()
    void load({ forceRefresh: true })
  }, [load])

  const filteredItems = useMemo(() => {
    return filterTransfersBySearch(items, searchQuery)
  }, [items, searchQuery])

  const columnOptions = useMemo(
    () =>
      MOVEMENT_TABLE_COLUMN_IDS.map((id) => ({
        id,
        label:
          id === 'from'
            ? t('admin:movement_page.from')
            : id === 'to'
              ? t('admin:movement_page.to')
              : id === 'qty'
                ? t('admin:movement_page.qty')
                : id === 'code'
                  ? t('admin:movement_page.col_code')
                  : id === 'barcode'
                    ? t('admin:movement_page.col_barcode')
                    : id === 'product'
                      ? t('admin:movement_page.col_product')
                      : id === 'batch'
                        ? t('inventory:columns.lot')
                        : id === 'created_by'
                          ? t('inventory:columns.created_by')
                          : t('inventory:columns.created_at'),
      })),
    [t]
  )

  const orderedVisibleColumns = useMemo(() => {
    const visible = new Set(tableConfig.visibleColumns)
    return tableConfig.columnOrder.filter(
      (id): id is MovementTableColumnId =>
        MOVEMENT_TABLE_COLUMN_IDS.includes(id as MovementTableColumnId) && visible.has(id)
    )
  }, [tableConfig.columnOrder, tableConfig.visibleColumns])

  const tableColumns = useMemo((): AdminDataTableColumn<WarehouseTransfer>[] => {
    return orderedVisibleColumns.map((colId) => ({
      id: colId,
      header: columnOptions.find((c) => c.id === colId)?.label ?? colId,
      width: movementThWidth(colId),
      align: colId === 'qty' ? 'right' : 'left',
      cell: (row) => renderMovementCell(colId, row),
    }))
  }, [orderedVisibleColumns, columnOptions])

  const buildExportFilterSummary = useCallback((): string[] => {
    const parts: string[] = []
    if (dateFrom.trim() || dateTo.trim()) {
      parts.push(
        `${t('admin:movement_page.export_filter_date')}: ${dateFrom.trim() || '…'} – ${dateTo.trim() || '…'}`
      )
    }
    if (searchQuery.trim()) {
      parts.push(`${t('admin:movement_page.export_filter_search')}: ${searchQuery.trim()}`)
    }
    if (parts.length === 0) {
      parts.push(t('admin:movement_page.export_filter_none'))
    }
    return parts
  }, [t, dateFrom, dateTo, searchQuery])

  const handleListExport = useCallback(
    async (kind: ExportFormat) => {
      showInfo(t('admin:movement_page.export_fetching'), 4000)
      try {
        const all = await fetchAllWarehouseTransfers({
          date_from: dateFrom.trim() || undefined,
          date_to: dateTo.trim() || undefined,
        })
        const filtered = filterTransfersBySearch(all, searchQuery)
        if (filtered.length === 0) {
          throw new Error(t('admin:movement_page.search_no_results'))
        }
        const rows = buildTransferListExportRows(filtered)
        const ctx = {
          title: t('admin:movement_page.export_list_title'),
          filterSummaryLines: buildExportFilterSummary(),
          rows,
          labels: buildTransferListExportLabels(t),
        }
        await runTransferListExport(kind, ctx)
        showSuccess(t('admin:movement_page.export_success'))
      } catch (err) {
        if (err instanceof TransferExportTooLargeError) {
          showError(t('admin:movement_page.export_too_large'))
        } else {
          showError(`${t('admin:movement_page.export_failed')}: ${formatUnknownError(err)}`)
        }
        throw err
      }
    },
    [t, dateFrom, dateTo, searchQuery, buildExportFilterSummary, showInfo, showSuccess, showError]
  )

  const applyDateFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (filterDateFrom.trim()) next.set('date_from', filterDateFrom.trim())
      else next.delete('date_from')
      if (filterDateTo.trim()) next.set('date_to', filterDateTo.trim())
      else next.delete('date_to')
      next.delete('offset')
      return next
    })
    setFilterPanelOpen(false)
    clearWarehouseTransfersClientCache()
  }

  const showInitialLoading = isLoading && !hasLoadedOnceRef.current

  const tableBody = () => {
    if (showInitialLoading) {
      return (
        <div className="relative min-h-[200px] flex-1">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
    }
    if (hasLoadError && items.length === 0) {
      return (
        <EmptyState
          title={t('inventory:load_failed')}
          actionLabel={t('common:buttons.refresh')}
          onAction={handleRefresh}
        />
      )
    }
    if (totalTransfers === 0 && !searchQuery.trim()) {
      return (
        <EmptyState
          title={t('admin:movement_page.empty_transfers')}
          description={t('admin:movement_page.empty_transfers_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={handleRefresh}
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
    if (orderedVisibleColumns.length === 0) {
      return (
        <EmptyState
          title={t('admin:movement_page.search_no_results')}
          description={t('admin:movement_page.table.columns_hint')}
        />
      )
    }
    return (
      <AdminDataTable
        columns={tableColumns}
        rows={filteredItems}
        getRowKey={(row) => row.id}
        minWidth="min-w-[56rem]"
        onRowClick={setDetailRow}
        refreshing={isRefreshing}
        refreshingLabel={t('common:messages.loading')}
      />
    )
  }

  return (
    <AdminLayout title={t('admin:menu.movement')}>
      <Card className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('admin:movement_page.list_title')}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1 max-w-xs">
              <Search
                size={18}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                type="search"
                placeholder={t('admin:movement_page.search_placeholder')}
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
                className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
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
                        className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-400"
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
                          setSearchParams((prev) => {
                            const next = new URLSearchParams(prev)
                            next.delete('date_from')
                            next.delete('date_to')
                            next.delete('offset')
                            return next
                          })
                          setFilterPanelOpen(false)
                          clearWarehouseTransfersClientCache()
                        }}
                      >
                        {t('orders:filters.filter_clear')}
                      </Button>
                      <Button onClick={applyDateFilters}>{t('inventory:filters.apply')}</Button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <Button
              variant="secondary"
              className="h-10 gap-1.5 rounded-xl px-3"
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
            >
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin shrink-0' : 'shrink-0'} />
              {t('common:buttons.refresh')}
            </Button>
            <Button
              variant="secondary"
              className="h-10 gap-1.5 rounded-xl px-3"
              onClick={() => setIsTableSettingsOpen(true)}
              title={t('admin:movement_page.table.settings_title')}
              aria-label={t('admin:movement_page.table.settings_title')}
            >
              <Settings size={18} />
            </Button>
            <ReceiptListExportToolbar
              disabled={isLoading || totalTransfers === 0}
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
        {!showInitialLoading && totalTransfers > 0 ? (
          <AdminTablePagination
            offset={offset}
            pageSize={PAGE_SIZE}
            total={totalTransfers}
            onPrev={() => {
              const newOffset = Math.max(0, offset - PAGE_SIZE)
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev)
                if (newOffset > 0) next.set('offset', String(newOffset))
                else next.delete('offset')
                return next
              })
            }}
            onNext={() => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev)
                next.set('offset', String(offset + PAGE_SIZE))
                return next
              })
            }}
          />
        ) : null}
      </Card>

      <MovementTableSettings
        open={isTableSettingsOpen}
        onOpenChange={setIsTableSettingsOpen}
        config={tableConfig}
        columns={columnOptions}
        onSave={updateTableConfig}
        onReset={resetTableConfig}
      />

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
              {t('admin:movement_page.detail_title')}
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {t('admin:movement_page.from')}:
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {detailRow.from_location_code ?? detailRow.from_location_id}
                </span>
                <ArrowRight size={16} className="text-slate-400" aria-hidden />
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {t('admin:movement_page.to')}:
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {detailRow.to_location_code ?? detailRow.to_location_id}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {t('admin:movement_page.qty')}:
                </span>
                <span className="text-slate-800 dark:text-slate-200">
                  {Math.round(Number(detailRow.qty))}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {t('admin:movement_page.col_code')}:
                </span>
                <span className="text-slate-800 dark:text-slate-200">
                  {detailRow.product_code ?? '—'}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {t('admin:movement_page.col_barcode')}:
                </span>
                <span className="text-slate-800 dark:text-slate-200">
                  {detailRow.product_barcode ?? '—'}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {t('admin:movement_page.col_product')}:
                </span>
                <span className="text-slate-800 dark:text-slate-200">
                  {detailRow.product_name ?? detailRow.product_id}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {t('kamomat:detail.batch')}:
                </span>
                <span className="text-slate-800 dark:text-slate-200">
                  {detailRow.batch ?? detailRow.lot_id}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {t('kamomat:detail.who')}:
                </span>
                <span className="text-slate-800 dark:text-slate-200">
                  {detailRow.created_by_username ?? detailRow.created_by_user_id ?? '—'}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {t('kamomat:detail.when')}:
                </span>
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
