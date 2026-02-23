import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Search, PackagePlus, Settings, FileSpreadsheet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { InventoryTableSettings } from '../../admin/components/inventory/InventoryTableSettings'
import { useInventoryTableConfig } from '../../admin/hooks/useInventoryTableConfig'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  getInventorySummaryLight,
  type InventorySummaryLightRow,
} from '../../services/inventoryApi'

const COLUMN_OPTIONS = [
  { id: 'code', labelKey: 'inventory:columns.code' },
  { id: 'barcode', labelKey: 'inventory:columns.barcode' },
  { id: 'product', labelKey: 'inventory:columns.product' },
  { id: 'brand', labelKey: 'inventory:columns.brand' },
  { id: 'total_qty', labelKey: 'inventory:columns.total_qty' },
  { id: 'available', labelKey: 'inventory:columns.available' },
]

const DEBOUNCE_MS = 400
const PAGE_SIZE = 50
const EXPORT_LIMIT = 10000

export function InventorySummaryPage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['inventory', 'common'])
  const { config, updateConfig, resetConfig } = useInventoryTableConfig()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [data, setData] = useState<{ items: InventorySummaryLightRow[]; total: number }>({
    items: [],
    total: 0,
  })
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await getInventorySummaryLight({
        search: debouncedSearch.trim() || undefined,
        only_available: onlyAvailable,
        include_locations: true,
        limit: PAGE_SIZE,
        offset,
      })
      setData({ items: res.items, total: res.total })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [debouncedSearch, onlyAvailable, offset, t])

  const prevSearchRef = useRef(debouncedSearch)
  const prevOnlyRef = useRef(onlyAvailable)
  useEffect(() => {
    if (prevSearchRef.current !== debouncedSearch || prevOnlyRef.current !== onlyAvailable) {
      prevSearchRef.current = debouncedSearch
      prevOnlyRef.current = onlyAvailable
      setOffset(0)
    }
  }, [debouncedSearch, onlyAvailable])

  useEffect(() => {
    void load()
  }, [load])

  const goPrev = useCallback(() => {
    setOffset((o) => Math.max(0, o - PAGE_SIZE))
  }, [])

  const goNext = useCallback(() => {
    setOffset((o) => o + PAGE_SIZE)
  }, [])

  const hasPrev = offset > 0
  const hasNext = offset + PAGE_SIZE < data.total
  const pageStart = data.total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + PAGE_SIZE, data.total)

  const handleExportExcel = useCallback(async () => {
    setIsExporting(true)
    try {
      const res = await getInventorySummaryLight({
        search: debouncedSearch.trim() || undefined,
        only_available: onlyAvailable,
        include_locations: true,
        limit: EXPORT_LIMIT,
        offset: 0,
      })
      const headers = [
        t('inventory:columns.code'),
        t('inventory:columns.barcode'),
        t('inventory:columns.product'),
        t('inventory:columns.brand'),
        t('inventory:columns.total_qty'),
        t('inventory:columns.available'),
        t('inventory:columns.location'),
      ]
      const rows = (res.items ?? []).map((row) => {
        const locs = row.locations ?? []
        const locationStr =
          locs.length === 0
            ? ''
            : locs
                .map((loc) => `${loc.location_code}${loc.expiry_date ? ` (${loc.expiry_date})` : ''} – ${Math.round(Number(loc.available_qty))}`)
                .join('; ')
        return [
          row.product_code,
          row.barcode ?? '',
          row.product_name,
          row.brand_name ?? '',
          Math.round(Number(row.total_qty)),
          Math.round(Number(row.available_qty)),
          locationStr,
        ]
      })
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      const wb = XLSX.utils.book_new()
      const sheetName = (t('inventory:title') || 'Qoldiq').slice(0, 31)
      XLSX.utils.book_append_sheet(wb, ws, sheetName)
      const fileName = `qoldiq_${new Date().toISOString().slice(0, 10)}.xlsx`
      XLSX.writeFile(wb, fileName)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('inventory:load_failed')
      setError(msg)
      window.alert(`${t('inventory:export_failed')}\n\n${msg}`)
    } finally {
      setIsExporting(false)
    }
  }, [debouncedSearch, onlyAvailable, t])

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return (
        <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
      )
    }
    if (data.items.length === 0) {
      return (
        <EmptyState
          title={t('inventory:empty')}
          description={t('inventory:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    const visibleColumns = new Set(config.visibleColumns)
    const orderedColumns = config.columnOrder.filter((id) =>
      COLUMN_OPTIONS.some((c) => c.id === id)
    )
    const columnLabels = new Map(COLUMN_OPTIONS.map((c) => [c.id, t(c.labelKey)]))

    return (
      <TableScrollArea inline>
        <table className="w-max min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {orderedColumns.map((columnId) =>
                visibleColumns.has(columnId) ? (
                  <th
                    key={columnId}
                    className={`px-3 py-3 text-left ${
                      columnId === 'barcode' ? 'min-w-[9rem]' : columnId === 'product' ? 'min-w-[12rem]' : ''
                    }`}
                  >
                    {columnLabels.get(columnId)}
                  </th>
                ) : null
              )}
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => {
              const locs = row.locations ?? []
              return (
                <tr
                  key={row.product_id}
                  className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
                >
                  {orderedColumns.map((columnId) =>
                    visibleColumns.has(columnId) ? (
                      <td
                      key={columnId}
                      className={`whitespace-nowrap px-3 py-3 ${
                        columnId === 'barcode' ? 'min-w-[9rem]' : columnId === 'product' ? 'min-w-[12rem]' : ''
                      }`}
                    >
                        {columnId === 'code' && (
                          <span className="font-mono">{row.product_code}</span>
                        )}
                        {columnId === 'barcode' && (
                          <span className="font-mono">{row.barcode ?? '—'}</span>
                        )}
                        {columnId === 'product' && (
                          <span
                            className="cursor-pointer font-semibold text-slate-900 dark:text-slate-100"
                            onClick={() => navigate(`/admin/inventory/${row.product_id}`)}
                            title={row.product_name}
                          >
                            {row.product_name}
                          </span>
                        )}
                        {columnId === 'brand' && (row.brand_name ?? '—')}
                        {columnId === 'total_qty' && Math.round(Number(row.total_qty))}
                        {columnId === 'available' && Math.round(Number(row.available_qty))}
                        {columnId === 'location' &&
                          (locs.length === 0 ? (
                          <Link
                            to="/admin/receiving"
                            state={{ productId: row.product_id }}
                            className="text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {t('inventory:enter_stock')}
                          </Link>
                        ) : locs.length === 1 ? (
                          locs[0].location_code
                        ) : (
                          <span className="block space-y-1">
                            {locs.map((loc, idx) => (
                              <span key={idx} className="block font-mono">
                                {loc.location_code}
                                {loc.expiry_date ? ` · ${loc.expiry_date}` : ''}
                              </span>
                            ))}
                          </span>
                          ))}
                      </td>
                    ) : null
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [config.columnOrder, config.visibleColumns, data.items, error, isLoading, load, navigate, t])

  return (
    <AdminLayout title={t('inventory:title')}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
            <Search size={18} className="text-slate-400" />
            <input
              className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
              placeholder={t('inventory:search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={onlyAvailable}
              onChange={(e) => setOnlyAvailable(e.target.checked)}
            />
            {t('inventory:filters.only_available')}
          </label>
          <Link
            to="/admin/receiving"
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-200 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <PackagePlus size={18} />
            {t('inventory:enter_stock')}
          </Link>
          <Button
            variant="ghost"
            className="rounded-full px-3 py-3"
            onClick={() => setIsSettingsOpen(true)}
            aria-label={t('inventory:table.settings_title')}
          >
            <Settings size={18} />
          </Button>
          <Button
            variant="secondary"
            onClick={handleExportExcel}
            disabled={isExporting}
            title={t('inventory:export_excel')}
            aria-label={t('inventory:export_excel')}
          >
            <FileSpreadsheet size={18} />
            <span className="hidden sm:inline">{t('inventory:export_excel')}</span>
          </Button>
          <Button variant="secondary" onClick={load}>
            {t('common:buttons.refresh')}
          </Button>
        </div>


        <div className="max-h-[calc(100vh-320px)] min-h-0 overflow-auto">
          {content}
        </div>

        <div className="flex items-center justify-end gap-2">
          {data.total > 0 ? (
            <span className="mr-auto text-sm text-slate-600 dark:text-slate-400">
              {pageStart}–{pageEnd} / {data.total}
            </span>
          ) : null}
          <Button variant="secondary" disabled={!hasPrev} onClick={goPrev}>
            {t('common:buttons.back')}
          </Button>
          <Button variant="secondary" disabled={!hasNext} onClick={goNext}>
            {t('common:buttons.next')}
          </Button>
        </div>
      </Card>
      <InventoryTableSettings
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        config={config}
        columns={COLUMN_OPTIONS.map((c) => ({ id: c.id, label: t(c.labelKey) }))}
        onSave={updateConfig}
        onReset={resetConfig}
      />
    </AdminLayout>
  )
}
