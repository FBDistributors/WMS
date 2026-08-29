import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import {
  Search,
  PackagePlus,
  Settings,
  FileSpreadsheet,
  ChevronDown,
  Loader2,
  CloudDownload,
  Filter,
  X,
  Upload,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { ImportInventoryDialog } from '../../admin/components/inventory/ImportInventoryDialog'
import { InventoryHeaderTabs } from '../../admin/components/inventory/InventoryHeaderTabs'
import { InventoryTableSettings } from '../../admin/components/inventory/InventoryTableSettings'
import { useInventoryTableConfig } from '../../admin/hooks/useInventoryTableConfig'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import {
  getInventorySummaryLight,
  type InventorySummaryLightRow,
  getSmartupBalance,
  type WarehouseFilter,
} from '../../services/inventoryApi'
import { getBrands, type Brand } from '../../services/brandsApi'
import { useAuth } from '../../rbac/AuthProvider'
import { useAppToast } from '../../feedback/useAppToast'
import { getSaleExpiryCutoff } from '../../services/appSettingsApi'
import { writeExcelFile } from '../../utils/exportExcel'
import {
  formatSmartupCacheTime,
  readSmartupSummaryCache,
  writeSmartupSummaryCache,
} from '../../lib/smartupBalanceLocalCache'
import {
  buildSmartupSummaryMaps,
  getSmartupTotalsForRow,
  hasSmartupMapData,
} from '../../lib/smartupBalanceMaps'

const COLUMN_OPTIONS = [
  { id: 'code', labelKey: 'inventory:columns.code' },
  { id: 'barcode', labelKey: 'inventory:columns.barcode' },
  { id: 'product', labelKey: 'inventory:columns.product' },
  { id: 'brand', labelKey: 'inventory:columns.brand' },
  { id: 'brand_id', labelKey: 'inventory:columns.brand_id' },
  { id: 'total_qty', labelKey: 'inventory:columns.total_qty' },
  { id: 'box_count', labelKey: 'inventory:columns.box_count' },
  { id: 'units_in_boxes', labelKey: 'inventory:columns.units_in_boxes' },
  { id: 'loose_units', labelKey: 'inventory:columns.loose_units' },
  { id: 'smartup_qoldiq', labelKey: 'inventory:columns.smartup_qoldiq' },
  { id: 'smartup_bron', labelKey: 'inventory:columns.smartup_bron' },
]

const NUMERIC_COLUMN_IDS = new Set([
  'total_qty',
  'box_count',
  'units_in_boxes',
  'loose_units',
  'smartup_qoldiq',
  'smartup_bron',
])

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

function readInitialSmartupState() {
  const cached = readSmartupSummaryCache()
  if (!cached) {
    return {
      q001: new Map<string, number>(),
      q002: new Map<string, number>(),
      q001Barcode: new Map<string, number>(),
      q002Barcode: new Map<string, number>(),
      loadedAt: null as string | null,
    }
  }
  return {
    q001: cached.q001,
    q002: cached.q002,
    q001Barcode: cached.q001Barcode,
    q002Barcode: cached.q002Barcode,
    loadedAt: cached.loadedAt,
  }
}

export function InventorySummaryPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const warehouse: WarehouseFilter = (searchParams.get('warehouse') as WarehouseFilter) || 'main'
  const { t, i18n } = useTranslation(['inventory', 'common'])
  const { has } = useAuth()
  const canAdjustInventory = has('inventory:adjust')
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
  const { showError, showSuccess } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [excelMenuOpen, setExcelMenuOpen] = useState(false)
  const [brandFilterOpen, setBrandFilterOpen] = useState(false)
  const [brandOptions, setBrandOptions] = useState<Brand[]>([])
  const [brandFilterLoading, setBrandFilterLoading] = useState(false)
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([])
  // Sotuv muddat chegarasi: shu sanadan oldin tugaydigan lotlar "sotuvga yopiq".
  const [saleCutoff, setSaleCutoff] = useState<string | null>(null)
  const excelMenuRef = useRef<HTMLDivElement>(null)
  const initialSmartup = useMemo(() => readInitialSmartupState(), [])
  const [smartupQoldiqByCode, setSmartupQoldiqByCode] = useState(initialSmartup.q001)
  const [smartupBronByCode, setSmartupBronByCode] = useState(initialSmartup.q002)
  const [smartupQoldiqByBarcode, setSmartupQoldiqByBarcode] = useState(initialSmartup.q001Barcode)
  const [smartupBronByBarcode, setSmartupBronByBarcode] = useState(initialSmartup.q002Barcode)
  const [isSmartupSyncing, setIsSmartupSyncing] = useState(false)
  const [smartupCachedAt, setSmartupCachedAt] = useState<string | null>(initialSmartup.loadedAt)
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  const applySmartupMaps = useCallback(
    (
      q001: Map<string, number>,
      q002: Map<string, number>,
      q001Barcode: Map<string, number>,
      q002Barcode: Map<string, number>,
      loadedAt: string,
    ) => {
      setSmartupQoldiqByCode(q001)
      setSmartupBronByCode(q002)
      setSmartupQoldiqByBarcode(q001Barcode)
      setSmartupBronByBarcode(q002Barcode)
      setSmartupCachedAt(loadedAt)
    },
    [],
  )

  const load = useCallback(async () => {
    setIsLoading(true)
    setHasLoadError(false)
    try {
      const summaryRes = await getInventorySummaryLight({
        search: debouncedSearch.trim() || undefined,
        brand_ids: selectedBrandIds.length > 0 ? selectedBrandIds : undefined,
        only_available: onlyAvailable,
        include_locations: true,
        limit: PAGE_SIZE,
        offset,
        warehouse,
      })
      setData({ items: summaryRes.items, total: summaryRes.total })
    } catch (err) {
      showError(err instanceof Error ? err.message : t('inventory:load_failed'))
      setHasLoadError(true)
      setData({ items: [], total: 0 })
    } finally {
      setIsLoading(false)
    }
  }, [debouncedSearch, selectedBrandIds, onlyAvailable, offset, warehouse, showError, t])

  const loadBrands = useCallback(async () => {
    setBrandFilterLoading(true)
    try {
      const rows = await getBrands(undefined, false)
      setBrandOptions(rows.filter((b) => b.is_active))
    } catch {
      setBrandOptions([])
    } finally {
      setBrandFilterLoading(false)
    }
  }, [])

  // fetchJSON xatoni Error emas, ApiError obyekt sifatida tashlaydi —
  // String() "[object Object]" bermasligi uchun message ni qo'lda ajratamiz.
  const smartupErrText = useCallback(
    (reason: unknown): string => {
      if (reason instanceof Error && reason.message) return reason.message
      if (reason && typeof reason === 'object') {
        const apiErr = reason as { message?: unknown; status?: unknown }
        if (typeof apiErr.message === 'string' && apiErr.message.trim()) return apiErr.message
        if (typeof apiErr.status === 'number') return `HTTP ${apiErr.status}`
      }
      return t('inventory:smartup_sync_failed')
    },
    [t],
  )

  const syncSmartupFromSource = useCallback(async () => {
    setIsSmartupSyncing(true)
    const prev = readSmartupSummaryCache()
    const settled = await Promise.allSettled([
      getSmartupBalance({ warehouse_code: '001', refresh: true }),
      getSmartupBalance({ warehouse_code: '002', refresh: true }),
    ])
    const q001 = settled[0]
    const q002 = settled[1]
    const errs: string[] = []
    let q001Map = prev?.q001 ?? new Map<string, number>()
    let q002Map = prev?.q002 ?? new Map<string, number>()
    let q001Bc = prev?.q001Barcode ?? new Map<string, number>()
    let q002Bc = prev?.q002Barcode ?? new Map<string, number>()
    if (q001.status === 'fulfilled') {
      const built = buildSmartupSummaryMaps(q001.value)
      q001Map = built.byCode
      q001Bc = built.byBarcode
    } else {
      errs.push(smartupErrText(q001.reason))
    }
    if (q002.status === 'fulfilled') {
      const built = buildSmartupSummaryMaps(q002.value)
      q002Map = built.byCode
      q002Bc = built.byBarcode
    } else {
      errs.push(smartupErrText(q002.reason))
    }
    const hasData =
      hasSmartupMapData(q001Map) ||
      hasSmartupMapData(q002Map) ||
      hasSmartupMapData(q001Bc) ||
      hasSmartupMapData(q002Bc)
    if (hasData) {
      const loadedAt = writeSmartupSummaryCache(q001Map, q002Map, q001Bc, q002Bc)
      applySmartupMaps(q001Map, q002Map, q001Bc, q002Bc, loadedAt)
    }
    if (errs.length > 0) {
      showError(errs.filter(Boolean).join(' · ') || t('inventory:smartup_sync_failed'))
    }
    setIsSmartupSyncing(false)
  }, [applySmartupMaps, showError, smartupErrText, t])

  useEffect(() => {
    if (
      hasSmartupMapData(smartupQoldiqByCode) ||
      hasSmartupMapData(smartupBronByCode) ||
      hasSmartupMapData(smartupQoldiqByBarcode) ||
      hasSmartupMapData(smartupBronByBarcode)
    ) {
      return
    }
    let cancelled = false
    ;(async () => {
      const settled = await Promise.allSettled([
        getSmartupBalance({ warehouse_code: '001' }),
        getSmartupBalance({ warehouse_code: '002' }),
      ])
      if (cancelled) return
      let q001Map = new Map<string, number>()
      let q002Map = new Map<string, number>()
      let q001Bc = new Map<string, number>()
      let q002Bc = new Map<string, number>()
      if (settled[0].status === 'fulfilled') {
        const built = buildSmartupSummaryMaps(settled[0].value)
        q001Map = built.byCode
        q001Bc = built.byBarcode
      }
      if (settled[1].status === 'fulfilled') {
        const built = buildSmartupSummaryMaps(settled[1].value)
        q002Map = built.byCode
        q002Bc = built.byBarcode
      }
      const hasData =
        hasSmartupMapData(q001Map) ||
        hasSmartupMapData(q002Map) ||
        hasSmartupMapData(q001Bc) ||
        hasSmartupMapData(q002Bc)
      if (!hasData) return
      const loadedAt = writeSmartupSummaryCache(q001Map, q002Map, q001Bc, q002Bc)
      applySmartupMaps(q001Map, q002Map, q001Bc, q002Bc, loadedAt)
    })()
    return () => {
      cancelled = true
    }
  }, [
    applySmartupMaps,
    smartupQoldiqByCode,
    smartupBronByCode,
    smartupQoldiqByBarcode,
    smartupBronByBarcode,
  ])

  const prevSearchRef = useRef(debouncedSearch)
  const prevOnlyRef = useRef(onlyAvailable)
  const prevWarehouseRef = useRef(warehouse)
  const prevBrandFilterRef = useRef(selectedBrandIds.join(','))
  useEffect(() => {
    const brandFilterKey = selectedBrandIds.join(',')
    if (
      prevSearchRef.current !== debouncedSearch ||
      prevOnlyRef.current !== onlyAvailable ||
      prevWarehouseRef.current !== warehouse ||
      prevBrandFilterRef.current !== brandFilterKey
    ) {
      prevSearchRef.current = debouncedSearch
      prevOnlyRef.current = onlyAvailable
      prevWarehouseRef.current = warehouse
      prevBrandFilterRef.current = brandFilterKey
      setOffset(0)
    }
  }, [debouncedSearch, selectedBrandIds, onlyAvailable, warehouse])

  useEffect(() => {
    if (!brandFilterOpen || brandOptions.length > 0 || brandFilterLoading) return
    void loadBrands()
  }, [brandFilterOpen, brandFilterLoading, brandOptions.length, loadBrands])

  useEffect(() => {
    // Belgi uchun bir marta; xato bo'lsa belgi shunchaki chiqmaydi (bloklamaydi).
    void getSaleExpiryCutoff()
      .then((d) => setSaleCutoff(d.cutoff))
      .catch(() => setSaleCutoff(null))
  }, [])

  const isSaleBlocked = useCallback(
    (expiry: string | null | undefined): boolean =>
      !!saleCutoff && !!expiry && expiry < saleCutoff,
    [saleCutoff],
  )

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
          brand_ids: selectedBrandIds.length > 0 ? selectedBrandIds : undefined,
          only_available: onlyAvailable,
          include_locations: true,
          limit: EXPORT_LIMIT,
          offset: 0,
          warehouse,
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
              loc.expiry_date ?? '',
            ])
          )
          const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
          const wb = XLSX.utils.book_new()
          XLSX.utils.book_append_sheet(wb, ws, sheetName)
          await writeExcelFile(wb, fileName)
          showSuccess(
            `${t('inventory:export_success')}. ${t('inventory:export_success_hint')}`,
            4000
          )
        } else {
          const headers = [
            t('inventory:columns.code'),
            t('inventory:columns.barcode'),
            t('inventory:columns.product'),
            t('inventory:columns.brand'),
            t('inventory:columns.total_qty'),
            t('inventory:columns.box_count'),
            t('inventory:columns.units_in_boxes'),
            t('inventory:columns.loose_units'),
            t('inventory:columns.smartup_qoldiq'),
            t('inventory:columns.smartup_bron'),
          ]
          const rows = (res.items ?? []).map((row) => {
            const jami = Math.round(Number(row.total_qty))
            const { total: smartupQoldiq } = getSmartupTotalsForRow(
              smartupQoldiqByCode,
              smartupQoldiqByBarcode,
              smartupBronByCode,
              smartupBronByBarcode,
              row.product_code,
              row.barcode,
            )
            const farq = jami - smartupQoldiq
            return [
              row.product_code,
              row.barcode ?? '',
              row.product_name,
              row.brand_name ?? '',
              jami,
              Math.round(Number(row.box_count ?? 0)),
              Math.round(Number(row.units_in_boxes ?? 0)),
              Math.round(Number(row.loose_units ?? 0)),
              smartupQoldiq === 0 ? '' : Math.round(smartupQoldiq),
              farq,
            ]
          })
          const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
          const wb = XLSX.utils.book_new()
          XLSX.utils.book_append_sheet(wb, ws, sheetName)
          await writeExcelFile(wb, fileName)
          showSuccess(
            `${t('inventory:export_success')}. ${t('inventory:export_success_hint')}`,
            4000
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('inventory:load_failed')
        showError(`${t('inventory:export_failed')}: ${msg}`)
      } finally {
        setIsExporting(false)
      }
    },
    [
      debouncedSearch,
      selectedBrandIds,
      onlyAvailable,
      warehouse,
      t,
      smartupQoldiqByCode,
      smartupBronByCode,
      smartupQoldiqByBarcode,
      smartupBronByBarcode,
      showSuccess,
      showError,
    ]
  )

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="relative min-h-[min(60vh,480px)]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
    }
    if (hasLoadError) {
      return (
        <EmptyState
          title={t('inventory:load_failed')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
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
    const columnLabels = new Map(
      COLUMN_OPTIONS.map((c) => [c.id, c.id === 'brand_id' ? 'Brand ID' : t(c.labelKey)])
    )

    return (
      <div className="relative">
        {isSmartupSyncing ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/60 dark:bg-slate-950/50">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <Loader2 size={18} className="animate-spin shrink-0" />
              {t('inventory:smartup_sync_loading')}
            </div>
          </div>
        ) : null}
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
                          : columnId === 'brand_id'
                            ? 'min-w-[14rem] text-left'
                          : NUMERIC_COLUMN_IDS.has(columnId)
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
                              : columnId === 'brand_id'
                                ? 'min-w-[14rem]'
                              : NUMERIC_COLUMN_IDS.has(columnId)
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
                        {columnId === 'brand_id' && (
                          <span className="font-mono text-xs">{row.brand_id ?? '—'}</span>
                        )}
                        {columnId === 'total_qty' && formatInt(row.total_qty)}
                        {columnId === 'box_count' && formatInt(row.box_count ?? 0)}
                        {columnId === 'units_in_boxes' && formatInt(row.units_in_boxes ?? 0)}
                        {columnId === 'loose_units' && formatInt(row.loose_units ?? 0)}
                        {columnId === 'smartup_qoldiq' &&
                          (() => {
                            const { q001, q002, total } = getSmartupTotalsForRow(
                              smartupQoldiqByCode,
                              smartupQoldiqByBarcode,
                              smartupBronByCode,
                              smartupBronByBarcode,
                              row.product_code,
                              row.barcode,
                            )
                            return q001 === 0 && q002 === 0 ? '—' : formatInt(total)
                          })()}
                        {columnId === 'smartup_bron' &&
                          (() => {
                            const jami = Math.round(Number(row.total_qty))
                            const { total: smartupQoldiq } = getSmartupTotalsForRow(
                              smartupQoldiqByCode,
                              smartupQoldiqByBarcode,
                              smartupBronByCode,
                              smartupBronByBarcode,
                              row.product_code,
                              row.barcode,
                            )
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
                          <span className="font-mono">
                            {locs[0].location_code}
                            {isSaleBlocked(locs[0].expiry_date) ? (
                              <span className="ml-1 rounded bg-rose-100 px-1 text-[10px] font-bold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                                {t('inventory:sale_blocked_badge')}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="block space-y-1">
                            {locs.map((loc, idx) => (
                              <span key={idx} className="block font-mono">
                                {loc.location_code}
                                {loc.expiry_date ? ` · ${loc.expiry_date}` : ''}
                                {isSaleBlocked(loc.expiry_date) ? (
                                  <span className="ml-1 rounded bg-rose-100 px-1 text-[10px] font-bold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                                    {t('inventory:sale_blocked_badge')}
                                  </span>
                                ) : null}
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
      </div>
    )
  }, [
    config.columnOrder,
    config.visibleColumns,
    data.items,
    hasLoadError,
    isLoading,
    isSmartupSyncing,
    load,
    navigate,
    smartupQoldiqByCode,
    smartupQoldiqByBarcode,
    smartupBronByCode,
    smartupBronByBarcode,
    isSaleBlocked,
    t,
  ])

  return (
    <AdminLayout titleSlot={<InventoryHeaderTabs />}>
      <Card className="space-y-4">
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              next.set('warehouse', 'main')
              setSearchParams(next)
            }}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              warehouse === 'main'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            {t('inventory:tabs.main')}
          </button>
          <button
            type="button"
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              next.set('warehouse', 'showroom')
              setSearchParams(next)
            }}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              warehouse === 'showroom'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            {t('inventory:tabs.showroom')}
          </button>
        </div>
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
          <Button
            variant="ghost"
            className="relative rounded-full px-3 py-3"
            onClick={() => setBrandFilterOpen(true)}
            title={t('inventory:filters.brand')}
            aria-label={t('inventory:filters.brand')}
          >
            <Filter size={18} />
            {selectedBrandIds.length > 0 ? (
              <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">
                {selectedBrandIds.length}
              </span>
            ) : null}
          </Button>
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
                {canAdjustInventory ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => {
                      setExcelMenuOpen(false)
                      setImportDialogOpen(true)
                    }}
                  >
                    <Upload size={16} />
                    {t('inventory:import_excel')}
                  </button>
                ) : null}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            className="shrink-0 rounded-full px-3 py-3"
            onClick={() => void syncSmartupFromSource()}
            disabled={isLoading || isSmartupSyncing}
            title={t('inventory:smartup_sync_hint')}
            aria-label={t('inventory:smartup_sync_aria')}
          >
            {isSmartupSyncing ? (
              <Loader2 size={18} className="animate-spin shrink-0" />
            ) : (
              <CloudDownload size={18} className="shrink-0" />
            )}
          </Button>
          <Button variant="secondary" onClick={load} disabled={isLoading} className="inline-flex items-center gap-2">
            {isLoading ? <Loader2 size={16} className="animate-spin shrink-0" /> : null}
            {t('common:buttons.refresh')}
          </Button>
        </div>

        {smartupCachedAt ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('inventory:smartup_cache_hint', {
              time: formatSmartupCacheTime(smartupCachedAt, i18n.language),
            })}
          </p>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('inventory:smartup_cache_empty_hint')}
          </p>
        )}

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
        columns={COLUMN_OPTIONS.map((c) => ({
          id: c.id,
          label: c.id === 'brand_id' ? 'Brand ID' : t(c.labelKey),
        }))}
        onSave={updateConfig}
        onReset={resetConfig}
      />
      {brandFilterOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('inventory:filters.brand')}
              </h3>
              <Button
                variant="ghost"
                className="rounded-full px-3 py-2"
                onClick={() => setBrandFilterOpen(false)}
                aria-label={t('common:buttons.close')}
              >
                <X size={16} />
              </Button>
            </div>
            <div className="space-y-3 px-6 py-5">
              {brandFilterLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 size={16} className="animate-spin" />
                  {t('common:messages.loading')}
                </div>
              ) : brandOptions.length === 0 ? (
                <p className="text-sm text-slate-500">{t('inventory:empty')}</p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-auto pr-1">
                  {brandOptions.map((brand) => {
                    const checked = selectedBrandIds.includes(brand.id)
                    return (
                      <label
                        key={brand.id}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedBrandIds((prev) =>
                                prev.includes(brand.id) ? prev : [...prev, brand.id]
                              )
                            } else {
                              setSelectedBrandIds((prev) => prev.filter((id) => id !== brand.id))
                            }
                          }}
                        />
                        <span className="text-slate-700 dark:text-slate-200">
                          {brand.display_name || brand.name}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedBrandIds([])
                }}
              >
                {t('inventory:table.reset_default')}
              </Button>
              <Button onClick={() => setBrandFilterOpen(false)}>{t('inventory:filters.apply')}</Button>
            </div>
          </div>
        </div>
      ) : null}
      <ImportInventoryDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        warehouse={warehouse}
        onSuccess={() => void load()}
      />
    </AdminLayout>
  )
}
