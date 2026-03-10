import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Search, PackagePlus, Settings, FileSpreadsheet, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { InventoryHeaderTabs } from '../../admin/components/inventory/InventoryHeaderTabs'
import { InventoryTableSettings } from '../../admin/components/inventory/InventoryTableSettings'
import { useInventoryTableConfig } from '../../admin/hooks/useInventoryTableConfig'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { TableSkeleton } from '../../components/ui/TableSkeleton'
import {
  getInventorySummaryLight,
  type InventorySummaryLightRow,
  getSmartupBalance,
} from '../../services/inventoryApi'

const COLUMN_OPTIONS = [
  { id: 'code', labelKey: 'inventory:columns.code' },
  { id: 'barcode', labelKey: 'inventory:columns.barcode' },
  { id: 'product', labelKey: 'inventory:columns.product' },
  { id: 'brand', labelKey: 'inventory:columns.brand' },
  { id: 'total_qty', labelKey: 'inventory:columns.total_qty' },
  { id: 'smartup_qoldiq', labelKey: 'inventory:columns.smartup_qoldiq' },
  { id: 'smartup_bron', labelKey: 'inventory:columns.smartup_bron' },
]

const DEBOUNCE_MS = 400
const PAGE_SIZE = 50
const EXPORT_LIMIT = 10000

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})

function formatInt(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value ?? '')
  return NUMBER_FORMATTER.format(Math.round(n))
}

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
  const [excelMenuOpen, setExcelMenuOpen] = useState(false)
  const excelMenuRef = useRef<HTMLDivElement>(null)
  const [smartupQoldiqByCode, setSmartupQoldiqByCode] = useState<Map<string, number>>(new Map())
  const [smartupBronByCode, setSmartupBronByCode] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [summaryRes, smartupQoldiqRes, smartupBronRes] = await Promise.all([
        getInventorySummaryLight({
          search: debouncedSearch.trim() || undefined,
          only_available: onlyAvailable,
          include_locations: true,
          limit: PAGE_SIZE,
          offset,
        }),
        getSmartupBalance({ warehouse_code: '001' }),
        getSmartupBalance({ warehouse_code: '002' }),
      ])

      setData({ items: summaryRes.items, total: summaryRes.total })

      const buildMap = (raw: unknown): Map<string, number> => {
        const result = new Map<string, number>()
        if (!raw || typeof raw !== 'object') return result
        const obj = raw as Record<string, unknown>
        const listSources = ['balance', 'items', 'data', 'movement', 'export']
        let rows: unknown[] = []
        if (Array.isArray(raw)) {
          rows = raw
        } else {
          for (const key of listSources) {
            const val = obj[key]
            if (Array.isArray(val)) {
              rows = val
              break
            }
          }
        }
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue
          const rec = row as Record<string, unknown>
          const keys = Object.keys(rec)
          const productKey =
            keys.find((k) => k.toLowerCase() === 'product_code') ??
            keys.find((k) => k.toLowerCase().includes('product') && k.toLowerCase().includes('code'))
          const qtyKey = keys.find((k) => k.toLowerCase() === 'quantity') ?? keys.find((k) => k.toLowerCase().startsWith('qty'))
          if (!productKey || !qtyKey) continue
          const codeRaw = rec[productKey]
          const qtyRaw = rec[qtyKey]
          if (codeRaw == null || qtyRaw == null) continue
          const code = String(codeRaw).trim()
          if (!code) continue
          const qtyNum = Number(qtyRaw)
          if (!Number.isFinite(qtyNum)) continue
          const prev = result.get(code) ?? 0
          result.set(code, prev + qtyNum)
        }
        return result
      }

      setSmartupQoldiqByCode(buildMap(smartupQoldiqRes))
      setSmartupBronByCode(buildMap(smartupBronRes))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory:load_failed'))
      setSmartupQoldiqByCode(new Map())
      setSmartupBronByCode(new Map())
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

  useEffect(() => {
    if (!excelMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (excelMenuRef.current && !excelMenuRef.current.contains(e.target as Node)) {
        setExcelMenuOpen(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [excelMenuOpen])

  const handleExportExcel = useCallback(
    async (withExpiry: boolean) => {
      setExcelMenuOpen(false)
      setIsExporting(true)
      try {
        const res = await getInventorySummaryLight({
          search: debouncedSearch.trim() || undefined,
          only_available: onlyAvailable,
          include_locations: true,
          limit: EXPORT_LIMIT,
          offset: 0,
        })
        const sheetName = (t('inventory:title') || 'Qoldiq').slice(0, 31)
        const fileName = withExpiry
          ? `qoldiq_muddati_${new Date().toISOString().slice(0, 10)}.xlsx`
          : `qoldiq_${new Date().toISOString().slice(0, 10)}.xlsx`

        if (withExpiry) {
          const headers = [
            t('inventory:columns.code'),
            t('inventory:columns.barcode'),
            t('inventory:columns.product'),
            t('inventory:columns.brand'),
            t('inventory:columns.location'),
            t('inventory:columns.qty'),
            t('inventory:columns.available'),
            t('inventory:columns.expiry'),
          ]
          const rows = (res.items ?? []).flatMap((row) =>
            (row.locations ?? []).map((loc) => [
              row.product_code,
              row.barcode ?? '',
              row.product_name,
              row.brand_name ?? '',
              loc.location_code,
              Math.round(Number(loc.qty)),
              Math.round(Number(loc.available_qty)),
              loc.expiry_date ?? '',
            ])
          )
          const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
          const wb = XLSX.utils.book_new()
          XLSX.utils.book_append_sheet(wb, ws, sheetName)
          XLSX.writeFile(wb, fileName)
        } else {
          const headers = [
            t('inventory:columns.code'),
            t('inventory:columns.barcode'),
            t('inventory:columns.product'),
            t('inventory:columns.brand'),
            t('inventory:columns.total_qty'),
            t('inventory:columns.smartup_qoldiq'),
            t('inventory:columns.smartup_bron'),
          ]
          const rows = (res.items ?? []).map((row) => {
            const jami = Math.round(Number(row.total_qty))
            const q001 = Number(smartupQoldiqByCode.get(row.product_code) ?? 0)
            const q002 = Number(smartupBronByCode.get(row.product_code) ?? 0)
            const smartupQoldiq = q001 + q002
            const farq = jami - smartupQoldiq
            return [
              row.product_code,
              row.barcode ?? '',
              row.product_name,
              row.brand_name ?? '',
              jami,
              smartupQoldiq === 0 ? '' : Math.round(smartupQoldiq),
              farq,
            ]
          })
          const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
          const wb = XLSX.utils.book_new()
          XLSX.utils.book_append_sheet(wb, ws, sheetName)
          XLSX.writeFile(wb, fileName)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('inventory:load_failed')
        setError(msg)
        window.alert(`${t('inventory:export_failed')}\n\n${msg}`)
      } finally {
        setIsExporting(false)
      }
    },
    [debouncedSearch, onlyAvailable, t, smartupQoldiqByCode, smartupBronByCode]
  )

  const content = useMemo(() => {
    if (isLoading) {
      return <TableSkeleton rows={6} columns={6} />
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
                    className={`px-3 py-3 ${
                      columnId === 'barcode'
                        ? 'min-w-[9rem] text-left'
                        : columnId === 'product'
                          ? 'min-w-[12rem] text-left'
                          : columnId === 'total_qty' ||
                              columnId === 'smartup_qoldiq' ||
                              columnId === 'smartup_bron'
                            ? 'text-right tabular-nums'
                            : 'text-left'
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
                          columnId === 'barcode'
                            ? 'min-w-[9rem]'
                            : columnId === 'product'
                              ? 'min-w-[12rem]'
                              : columnId === 'total_qty' ||
                                  columnId === 'smartup_qoldiq' ||
                                  columnId === 'smartup_bron'
                                ? 'text-right tabular-nums'
                                : ''
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
                        {columnId === 'total_qty' && formatInt(row.total_qty)}
                        {columnId === 'smartup_qoldiq' &&
                          (() => {
                            const q001 = Number(smartupQoldiqByCode.get(row.product_code) ?? 0)
                            const q002 = Number(smartupBronByCode.get(row.product_code) ?? 0)
                            const sum = q001 + q002
                            return q001 === 0 && q002 === 0 ? '—' : formatInt(sum)
                          })()}
                        {columnId === 'smartup_bron' &&
                          (() => {
                            const jami = Math.round(Number(row.total_qty))
                            const q001 = Number(smartupQoldiqByCode.get(row.product_code) ?? 0)
                            const q002 = Number(smartupBronByCode.get(row.product_code) ?? 0)
                            const smartupQoldiq = q001 + q002
                            const farq = jami - smartupQoldiq
                            if (farq === 0) return 0
                            const formatted = formatInt(farq)
                            return (
                              <span className="text-rose-500">
                                {formatted}
                              </span>
                            )
                          })()}
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
  }, [
    config.columnOrder,
    config.visibleColumns,
    data.items,
    error,
    isLoading,
    load,
    navigate,
    smartupQoldiqByCode,
    smartupBronByCode,
    t,
  ])

  return (
    <AdminLayout titleSlot={<InventoryHeaderTabs />}>
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
          <div className="relative" ref={excelMenuRef}>
            <Button
              variant="secondary"
              onClick={() => setExcelMenuOpen((o) => !o)}
              disabled={isExporting}
              title={t('inventory:export_excel')}
              aria-label={t('inventory:export_excel')}
              aria-expanded={excelMenuOpen}
            >
              <FileSpreadsheet size={18} />
              <ChevronDown size={16} className="opacity-70" />
            </Button>
            {excelMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[12rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => handleExportExcel(true)}
                >
                  <FileSpreadsheet size={16} />
                  {t('inventory:export_with_expiry')}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => handleExportExcel(false)}
                >
                  <FileSpreadsheet size={16} />
                  {t('inventory:export_qty_only')}
                </button>
              </div>
            )}
          </div>
          <Button variant="secondary" onClick={load}>
            {t('common:buttons.refresh')}
          </Button>
        </div>


        <div className="max-h-[calc(100vh-240px)] min-h-0 overflow-auto">
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
