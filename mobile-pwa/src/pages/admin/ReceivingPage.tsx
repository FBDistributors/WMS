import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Filter, Plus, Search, Settings, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { ReceiptListExportToolbar } from '../../admin/components/receiving/ReceiptListExportToolbar'
import { ReceivingTableSettings } from '../../admin/components/receiving/ReceivingTableSettings'
import {
  useReceivingTableConfig,
  type ReceivingTableColumnId,
  RECEIVING_TABLE_COLUMN_IDS,
} from '../../admin/hooks/useReceivingTableConfig'
import type { ExportFormat } from '../../admin/components/receiving/ExportFormatDropdown'
import { FloatingSnackBar } from '../../components/ui/FloatingSnackBar'
import { ProductSearchCombobox, formatProductLabel } from '../../components/ProductSearchCombobox'
import { LocationSearchCombobox, formatLocationLabel } from '../../components/LocationSearchCombobox'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { DateInput } from '../../components/DateInput'
import { MonthYearInput } from '../../components/MonthYearInput'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { TableScrollArea } from '../../components/TableScrollArea'
import { getProducts, type Product } from '../../services/productsApi'
import { getLocations, type Location } from '../../services/locationsApi'
import { getBrands, type Brand } from '../../services/brandsApi'
import {
  createReceipt,
  listReceipts,
  fetchAllReceipts,
  ReceiptExportTooLargeError,
  getReceivers,
  completeReceipt,
  type Receipt,
  type ReceiptLineCreate,
  type Receiver,
} from '../../services/receivingApi'
import { getInventorySummary } from '../../services/inventoryApi'
import {
  buildReceiptListExportLabels,
  buildReceiptListExportRows,
  type ReceiptListExportRow,
  downloadReceiptListCsv,
  downloadReceiptListExcel,
  downloadReceiptListPdf,
  filterReceiptsBySearch,
  type ReceiptListExportContext,
} from '../../utils/receiptListExport'
import { useAuth } from '../../rbac/AuthProvider'
import { sanitizeStockQtyDigits } from '../../lib/stockQtyInput'

type LineDraft = Omit<ReceiptLineCreate, 'qty'> & { id: string; qty: number | '' }

const EMPTY_LINE: LineDraft = {
  id: 'line-0',
  product_id: '',
  qty: '',
  batch: '',
  expiry_date: null,
  location_id: '',
}

const PAGE_SIZE = 50

type FlatReceiptTableRow = ReceiptListExportRow & {
  receiptId: string
  lineId: string
  showComplete: boolean
}

const TH_CLASS =
  'text-left py-2.5 px-3 text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300 align-middle whitespace-nowrap'
const TD_BASE = 'py-2.5 px-3 align-middle text-sm text-slate-900 dark:text-slate-100'

function receivingThWidth(col: ReceivingTableColumnId): string | undefined {
  const widths: Partial<Record<ReceivingTableColumnId, string>> = {
    doc_no: '10rem',
    status: '7rem',
    received_by: '8rem',
    received_at: '9rem',
    code: '5rem',
    barcode: '9rem',
    product: '18rem',
    qty: '4.5rem',
    qoldiq: '4.5rem',
    batch: '7rem',
    expiry: '7rem',
    location: '5.5rem',
  }
  return widths[col]
}

export function ReceivingPage() {
  const { t } = useTranslation(['receiving', 'common'])
  const [searchParams, setSearchParams] = useSearchParams()
  const { has } = useAuth()
  const canWrite = has('receiving:write')

  const [products, setProducts] = useState<Product[]>([])
  const [selectedProducts, setSelectedProducts] = useState<Map<string, Product>>(new Map())
  const [locations, setLocations] = useState<Location[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [totalReceipts, setTotalReceipts] = useState(0)
  const [receivers, setReceivers] = useState<Receiver[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)

  const searchQuery = searchParams.get('q') ?? ''
  const brandFilter = searchParams.get('brand_id') ?? ''
  const receiverFilter = searchParams.get('created_by') ?? ''
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10))

  const [filterBrandId, setFilterBrandId] = useState<string>('')
  const [filterReceiver, setFilterReceiver] = useState<string>('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [docNo, setDocNo] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snackMessage, setSnackMessage] = useState<string | null>(null)
  const [snackVariant, setSnackVariant] = useState<'success' | 'error'>('success')
  const [inventoryMap, setInventoryMap] = useState<Map<string, number>>(new Map())
  const [isTableSettingsOpen, setIsTableSettingsOpen] = useState(false)
  const { config: tableConfig, updateConfig: updateTableConfig, resetConfig: resetTableConfig } =
    useReceivingTableConfig()

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [locationsResponse, receiptsResponse] = await Promise.all([
        getLocations(false),
        listReceipts({
          created_by: receiverFilter.trim() || undefined,
          brand_id: brandFilter.trim() || undefined,
          date_from: dateFrom.trim() || undefined,
          date_to: dateTo.trim() || undefined,
          limit: PAGE_SIZE,
          offset,
        }),
      ])
      setLocations(locationsResponse)
      setReceipts(receiptsResponse.items)
      setTotalReceipts(receiptsResponse.total)

      const productIds = [
        ...new Set(
          receiptsResponse.items.flatMap((r) =>
            r.lines.map((l) => l.product_id).filter(Boolean)
          ),
        ),
      ]
      if (productIds.length > 0) {
        const [productsResponse, inventoryRows] = await Promise.all([
          getProducts({
            product_ids: productIds,
            limit: productIds.length,
          }),
          getInventorySummary({ product_ids: productIds }),
        ])
        setProducts(productsResponse.items)
        const inv = new Map<string, number>()
        inventoryRows.forEach((row) => {
          inv.set(row.product_id, Math.round(Number(row.on_hand_total)))
        })
        setInventoryMap(inv)
      } else {
        setProducts([])
        setInventoryMap(new Map())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receiving:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [t, receiverFilter, brandFilter, dateFrom, dateTo, offset])

  const loadReceivers = useCallback(async () => {
    try {
      const list = await getReceivers()
      setReceivers(list)
    } catch {
      setReceivers([])
    }
  }, [])

  const loadBrands = useCallback(async () => {
    try {
      const list = await getBrands(undefined, true)
      setBrands(list)
    } catch {
      setBrands([])
    }
  }, [])

  useEffect(() => {
    void loadReceivers()
  }, [loadReceivers])
  useEffect(() => {
    void loadBrands()
  }, [loadBrands])

  useEffect(() => {
    void load()
  }, [load])

  const filteredReceipts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return receipts
    return receipts.filter((r) => {
      const matchDoc = r.doc_no?.toLowerCase().includes(q)
      const matchUser = r.created_by_username?.toLowerCase().includes(q)
      return matchDoc || matchUser
    })
  }, [receipts, searchQuery])

  const receiverOptions = useMemo(() => {
    const byId = new Map<string, Receiver>()
    receivers.forEach((r) => byId.set(r.id, r))
    receipts.forEach((r) => {
      if (r.created_by && r.created_by_username && !byId.has(r.created_by)) {
        byId.set(r.created_by, { id: r.created_by, name: r.created_by_username })
      }
    })
    return Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    )
  }, [receivers, receipts])

  const productLookup = useMemo(() => {
    const map = new Map<string, Product>(products.map((p) => [p.id, p]))
    selectedProducts.forEach((p) => map.set(p.id, p))
    return map
  }, [products, selectedProducts])

  const locationLookup = useMemo(() => {
    const map = new Map(locations.map((location) => [location.id, location]))
    return map
  }, [locations])

  const flatRows = useMemo((): FlatReceiptTableRow[] => {
    const exportRows = buildReceiptListExportRows(
      filteredReceipts,
      productLookup,
      locationLookup,
      inventoryMap,
      (status) => t(`receiving:statuses.${status}`)
    )
    const result: FlatReceiptTableRow[] = []
    const completeShown = new Set<string>()
    let idx = 0
    for (const receipt of filteredReceipts) {
      const lines = receipt.lines.length > 0 ? receipt.lines : []
      for (const line of lines) {
        const row = exportRows[idx]
        idx += 1
        if (!row) continue
        const showComplete =
          receipt.status === 'draft' && !completeShown.has(receipt.id)
        if (showComplete) {
          completeShown.add(receipt.id)
        }
        result.push({
          ...row,
          receiptId: receipt.id,
          lineId: line.id,
          showComplete,
        })
      }
    }
    return result
  }, [filteredReceipts, productLookup, locationLookup, inventoryMap, t])

  const columnOptions = useMemo(
    () =>
      RECEIVING_TABLE_COLUMN_IDS.map((id) => ({
        id,
        label:
          id === 'doc_no'
            ? t('receiving:col_doc_no')
            : id === 'status'
              ? t('receiving:col_status')
              : id === 'received_by'
                ? t('receiving:col_received_by')
                : id === 'received_at'
                  ? t('receiving:col_received_at')
                  : id === 'code'
                    ? t('receiving:detail_col_code')
                    : id === 'barcode'
                      ? t('receiving:detail_col_barcode')
                      : id === 'product'
                        ? t('receiving:detail_col_product')
                        : id === 'qty'
                          ? t('receiving:fields.qty')
                          : id === 'qoldiq'
                            ? t('receiving:detail_col_qoldiq')
                            : id === 'batch'
                              ? t('receiving:fields.batch')
                              : id === 'expiry'
                                ? t('receiving:fields.expiry_date')
                                : t('receiving:fields.location'),
      })),
    [t]
  )

  const orderedVisibleColumns = useMemo(() => {
    const visible = new Set(tableConfig.visibleColumns)
    return tableConfig.columnOrder.filter(
      (id): id is ReceivingTableColumnId =>
        RECEIVING_TABLE_COLUMN_IDS.includes(id as ReceivingTableColumnId) && visible.has(id)
    )
  }, [tableConfig.columnOrder, tableConfig.visibleColumns])

  const buildExportFilterSummary = useCallback((): string[] => {
    const parts: string[] = []
    if (dateFrom.trim() || dateTo.trim()) {
      parts.push(
        `${t('receiving:export_filter_date')}: ${dateFrom.trim() || '…'} – ${dateTo.trim() || '…'}`
      )
    }
    if (brandFilter.trim()) {
      const b = brands.find((br) => br.id === brandFilter.trim())
      parts.push(
        `${t('receiving:export_filter_brand')}: ${b?.display_name || b?.name || b?.code || brandFilter}`
      )
    }
    if (receiverFilter.trim()) {
      const r = receiverOptions.find((rec) => rec.id === receiverFilter.trim())
      parts.push(
        `${t('receiving:export_filter_receiver')}: ${r?.name ?? receiverFilter}`
      )
    }
    if (searchQuery.trim()) {
      parts.push(`${t('receiving:export_filter_search')}: ${searchQuery.trim()}`)
    }
    if (parts.length === 0) {
      parts.push(t('receiving:export_filter_none'))
    }
    return parts
  }, [
    t,
    dateFrom,
    dateTo,
    brandFilter,
    receiverFilter,
    searchQuery,
    brands,
    receiverOptions,
  ])

  const handleListExport = useCallback(
    async (kind: ExportFormat) => {
      setSnackVariant('success')
      setSnackMessage(t('receiving:export_fetching'))
      try {
        const all = await fetchAllReceipts({
          created_by: receiverFilter.trim() || undefined,
          brand_id: brandFilter.trim() || undefined,
          date_from: dateFrom.trim() || undefined,
          date_to: dateTo.trim() || undefined,
        })
        const filtered = filterReceiptsBySearch(all, searchQuery)
        if (filtered.length === 0) {
          throw new Error(t('receiving:no_results'))
        }

        const productIds = [
          ...new Set(
            filtered.flatMap((r) =>
              r.lines.map((l) => l.product_id).filter(Boolean)
            )
          ),
        ]
        const [productsRes, locationsData, inventoryRows] = await Promise.all([
          productIds.length > 0
            ? getProducts({ product_ids: productIds, limit: productIds.length })
            : Promise.resolve({ items: [] as Product[] }),
          getLocations(false),
          productIds.length > 0
            ? getInventorySummary({ product_ids: productIds })
            : Promise.resolve([]),
        ])

        const exportProductLookup = new Map(productsRes.items.map((p) => [p.id, p]))
        const exportLocationLookup = new Map(locationsData.map((loc) => [loc.id, loc]))
        const inventoryMap = new Map<string, number>()
        inventoryRows.forEach((row) => {
          inventoryMap.set(row.product_id, Math.round(Number(row.on_hand_total)))
        })

        const rows = buildReceiptListExportRows(
          filtered,
          exportProductLookup,
          exportLocationLookup,
          inventoryMap,
          (status) => t(`receiving:statuses.${status}`)
        )

        const ctx: ReceiptListExportContext = {
          title: t('receiving:export_list_title'),
          filterSummaryLines: buildExportFilterSummary(),
          rows,
          receiptCount: filtered.length,
          lineCount: rows.length,
          labels: buildReceiptListExportLabels(t),
        }

        if (kind === 'excel') {
          await downloadReceiptListExcel(ctx)
        } else if (kind === 'csv') {
          downloadReceiptListCsv(ctx)
        } else {
          await downloadReceiptListPdf(ctx)
        }

        setSnackVariant('success')
        setSnackMessage(t('receiving:export_success'))
      } catch (err) {
        if (err instanceof ReceiptExportTooLargeError) {
          setSnackVariant('error')
          setSnackMessage(t('receiving:export_too_large'))
        } else {
          setSnackVariant('error')
          setSnackMessage(
            `${t('receiving:export_failed')}: ${err instanceof Error ? err.message : String(err)}`
          )
        }
        throw err
      }
    },
    [
      t,
      receiverFilter,
      brandFilter,
      dateFrom,
      dateTo,
      searchQuery,
      buildExportFilterSummary,
    ]
  )

  useEffect(() => {
    if (filterPanelOpen) {
      setFilterBrandId(brandFilter)
      setFilterReceiver(receiverFilter)
      setFilterDateFrom(dateFrom)
      setFilterDateTo(dateTo)
    }
  }, [filterPanelOpen, brandFilter, receiverFilter, dateFrom, dateTo])

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { ...EMPTY_LINE, id: `line-${prev.length + 1}` },
    ])
  }

  const removeLine = (id: string) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.id !== id)))
  }

  const updateLine = (id: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  }

  const openCreateModal = () => {
    setError(null)
    setDocNo('')
    setLines([{ ...EMPTY_LINE }])
    setSelectedProducts(new Map())
    setCreateModalOpen(true)
  }

  const handleSubmit = async () => {
    if (!canWrite) return
    if (!lines.length) {
      setError(t('receiving:validation.lines_required'))
      return
    }
    const invalid = lines.some(
      (line) =>
        !line.product_id ||
        !line.location_id ||
        !line.batch.trim() ||
        line.qty === '' ||
        Number(line.qty) <= 0
    )
    if (invalid) {
      setError(t('receiving:validation.line_invalid'))
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const created = await createReceipt({
        doc_no: docNo.trim() || undefined,
        lines: lines.map(({ id, ...line }) => ({
          ...line,
          qty: Math.max(1, Math.floor(Number(line.qty))),
          batch: line.batch.trim(),
          expiry_date: line.expiry_date || null,
        })),
      })
      await completeReceipt(created.id)
      setCreateModalOpen(false)
      setDocNo('')
      setLines([{ ...EMPTY_LINE }])
      setSelectedProducts(new Map())
      await load()
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : err instanceof Error
            ? err.message
            : t('receiving:save_failed')
      setError(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleComplete = useCallback(
    async (receiptId: string) => {
      if (!canWrite) return
      setIsSubmitting(true)
      setError(null)
      try {
        await completeReceipt(receiptId)
        await load()
      } catch (err) {
        const msg =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: string }).message)
            : err instanceof Error
              ? err.message
              : t('receiving:complete_failed')
        setError(msg)
      } finally {
        setIsSubmitting(false)
      }
    },
    [canWrite, load, t]
  )

  const renderReceivingCell = useCallback(
    (colId: ReceivingTableColumnId, row: FlatReceiptTableRow) => {
      switch (colId) {
        case 'doc_no':
          return (
            <span className="block truncate" title={row.docNo}>
              {row.docNo}
            </span>
          )
        case 'status':
          return (
            <div className="flex flex-col items-start gap-1.5">
              <span className="inline-block max-w-full truncate" title={row.status}>
                {row.status}
              </span>
              {row.showComplete && canWrite ? (
                <Button
                  className="h-7 px-2 text-xs"
                  onClick={() => void handleComplete(row.receiptId)}
                  disabled={isSubmitting}
                >
                  {t('receiving:complete')}
                </Button>
              ) : null}
            </div>
          )
        case 'received_by':
          return (
            <span className="block truncate" title={row.receivedBy}>
              {row.receivedBy}
            </span>
          )
        case 'received_at':
          return <span className="whitespace-nowrap text-xs">{row.receivedAt}</span>
        case 'code':
          return <span className="whitespace-nowrap">{row.code}</span>
        case 'barcode':
          return (
            <span className="block truncate font-mono text-xs" title={row.barcode}>
              {row.barcode}
            </span>
          )
        case 'product':
          return (
            <span
              className="line-clamp-2 text-sm leading-snug"
              title={row.productName}
            >
              {row.productName}
            </span>
          )
        case 'qty':
          return <span className="tabular-nums">{row.qty}</span>
        case 'qoldiq':
          return <span className="tabular-nums">{row.qoldiq}</span>
        case 'batch':
          return (
            <span className="block truncate font-mono text-xs" title={String(row.batch)}>
              {row.batch}
            </span>
          )
        case 'expiry':
          return <span className="whitespace-nowrap text-xs">{row.expiry}</span>
        case 'location':
          return <span className="whitespace-nowrap">{row.location}</span>
        default:
          return null
      }
    },
    [canWrite, handleComplete, isSubmitting, t]
  )

  const createForm = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('receiving:create_title')}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {t('receiving:create_subtitle')}
          </div>
        </div>
        <Button variant="ghost" className="shrink-0 p-2" onClick={() => setCreateModalOpen(false)} aria-label={t('common:buttons.close')}>
          <X size={20} />
        </Button>
      </div>
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
          {error}
        </div>
      ) : null}
      <p className="text-xs text-slate-500 dark:text-slate-400" role="note">
        {t('receiving:rule_location_single_expiry')}
      </p>
      <label className="text-sm text-slate-600 dark:text-slate-300">
        {t('receiving:fields.doc_no')}
        <input
          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          value={docNo}
          onChange={(event) => setDocNo(event.target.value)}
          placeholder={t('receiving:fields.doc_no_placeholder')}
        />
      </label>

      <div className="space-y-3 max-h-[50vh] overflow-y-auto">
        {lines.map((line, index) => (
          <div key={line.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('receiving:line')} {index + 1}
              </div>
              <Button variant="ghost" onClick={() => removeLine(line.id)}>
                <Trash2 size={16} />
              </Button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-600 dark:text-slate-300">
                {t('receiving:fields.product')}
                <div className="mt-1">
                  <ProductSearchCombobox
                    value={line.product_id}
                    placeholder={t('receiving:fields.select_product')}
                    displayLabel={
                      line.product_id
                        ? (() => {
                            const p = productLookup.get(line.product_id)
                            return p ? formatProductLabel(p) : ''
                          })()
                        : undefined
                    }
                    onSelect={(product) => {
                      if (product) {
                        setSelectedProducts((prev) => new Map(prev).set(product.id, product))
                        updateLine(line.id, { product_id: product.id })
                      } else {
                        updateLine(line.id, { product_id: '' })
                      }
                    }}
                    className="w-full"
                  />
                </div>
              </label>
              <label className="text-sm text-slate-600 dark:text-slate-300">
                {t('receiving:fields.location')}
                <LocationSearchCombobox
                  locations={locations}
                  value={line.location_id}
                  displayLabel={
                    line.location_id
                      ? (() => {
                          const loc = locationLookup.get(line.location_id)
                          return loc ? formatLocationLabel(loc) : ''
                        })()
                      : undefined
                  }
                  onSelect={(loc) =>
                    updateLine(line.id, { location_id: loc?.id ?? '' })
                  }
                  placeholder={t('receiving:fields.select_location')}
                  className="mt-1 w-full"
                />
              </label>
              <label className="text-sm text-slate-600 dark:text-slate-300">
                {t('receiving:fields.qty')}
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder=""
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                  value={line.qty === '' ? '' : line.qty}
                  onChange={(event) => {
                    const raw = sanitizeStockQtyDigits(event.target.value)
                    if (raw === '') {
                      updateLine(line.id, { qty: '' })
                      return
                    }
                    const num = parseInt(raw, 10)
                    if (!isNaN(num) && num >= 0) {
                      updateLine(line.id, { qty: num })
                    }
                  }}
                />
              </label>
              <label className="text-sm text-slate-600 dark:text-slate-300">
                {t('receiving:fields.batch')}
                <input
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                  value={line.batch}
                  onChange={(event) => updateLine(line.id, { batch: event.target.value })}
                />
              </label>
              <label className="text-sm text-slate-600 dark:text-slate-300">
                {t('receiving:fields.expiry_date')}
                <MonthYearInput
                  value={line.expiry_date ?? ''}
                  onChange={(val) => updateLine(line.id, { expiry_date: val || null })}
                  className="mt-1 w-full"
                  aria-label={t('receiving:fields.expiry_date')}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={addLine}>
          <Plus size={16} />
          {t('receiving:add_line')}
        </Button>
        <Button onClick={handleSubmit} disabled={!canWrite || isSubmitting}>
          {isSubmitting ? t('receiving:saving') : t('receiving:create')}
        </Button>
      </div>
    </div>
  )

  return (
    <AdminLayout
      title={t('receiving:title')}
      actionSlot={
        canWrite ? (
          <Button onClick={openCreateModal}>
            <Plus size={18} />
            {t('receiving:create')}
          </Button>
        ) : null
      }
    >
      {createModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => !isSubmitting && setCreateModalOpen(false)}
            aria-hidden
          />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            {createForm}
          </div>
        </div>
      ) : null}

      <FloatingSnackBar
        message={snackMessage}
        variant={snackVariant}
        onDismiss={() => setSnackMessage(null)}
      />

      <Card className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('receiving:list_title')}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                aria-hidden
              />
              <input
                type="search"
                placeholder={t('receiving:search_placeholder')}
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
                aria-label={t('receiving:search_placeholder')}
              />
            </div>
            <div className="relative" ref={filterPanelRef}>
              <Button
                variant="outline"
                onClick={() => setFilterPanelOpen((open) => !open)}
                className="gap-2"
                aria-label={t('receiving:filter_btn')}
                aria-expanded={filterPanelOpen}
              >
                <Filter size={18} />
                {t('receiving:filter_btn')}
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
                        {t('receiving:filter_panel_title')}
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
                        {t('receiving:col_doc_no')}
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchParams((prev) => {
                              const next = new URLSearchParams(prev)
                              if (e.target.value) next.set('q', e.target.value)
                              else next.delete('q')
                              next.delete('offset')
                              return next
                            })
                          }}
                          placeholder={t('receiving:filter_doc_placeholder')}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                      </label>
                      <label className="block text-sm text-slate-600 dark:text-slate-400">
                        {t('receiving:filter_by_brand')}
                        <select
                          value={filterBrandId}
                          onChange={(e) => setFilterBrandId(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          <option value="">{t('receiving:filter_all_brands')}</option>
                          {brands.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.display_name || b.name || b.code}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm text-slate-600 dark:text-slate-400">
                        {t('receiving:filter_receiver')}
                        <select
                          value={filterReceiver}
                          onChange={(e) => setFilterReceiver(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          <option value="">{t('receiving:filter_all_receivers')}</option>
                          {receiverOptions.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-sm text-slate-600 dark:text-slate-400">
                          {t('receiving:date_from')}
                          <DateInput
                            value={filterDateFrom}
                            onChange={setFilterDateFrom}
                            className="mt-1 w-full"
                            aria-label={t('receiving:date_from')}
                          />
                        </label>
                        <label className="block text-sm text-slate-600 dark:text-slate-400">
                          {t('receiving:date_to')}
                          <DateInput
                            value={filterDateTo}
                            onChange={setFilterDateTo}
                            className="mt-1 w-full"
                            aria-label={t('receiving:date_to')}
                          />
                        </label>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSearchParams({})
                          setFilterPanelOpen(false)
                        }}
                      >
                        {t('receiving:filter_clear')}
                      </Button>
                      <Button
                          onClick={() => {
                          setSearchParams((prev) => {
                            const next = new URLSearchParams(prev)
                            const bid = filterBrandId.trim()
                            const rid = filterReceiver.trim()
                            const df = filterDateFrom.trim()
                            const dt = filterDateTo.trim()
                            next.delete('product_id')
                            if (bid) next.set('brand_id', bid)
                            else next.delete('brand_id')
                            if (rid) next.set('created_by', rid)
                            else next.delete('created_by')
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
              onClick={() => setIsTableSettingsOpen(true)}
              title={t('receiving:table.settings_title')}
              aria-label={t('receiving:table.settings_title')}
            >
              <Settings size={18} />
            </Button>
            <ReceiptListExportToolbar
              disabled={isLoading || totalReceipts === 0}
              onExport={async (kind) => {
                try {
                  await handleListExport(kind)
                } catch {
                  /* snackbar set in handleListExport */
                }
              }}
            />
          </div>
        </div>
        {isLoading ? (
          <div className="relative flex-1 min-h-[200px]">
            <LoadingOverlay label={t('common:messages.loading')} />
          </div>
        ) : receipts.length === 0 ? (
          <EmptyState title={t('receiving:empty')} description={t('receiving:empty_desc')} />
        ) : filteredReceipts.length === 0 ? (
          <EmptyState
            title={t('receiving:no_results')}
            description={t('receiving:no_results_desc')}
          />
        ) : flatRows.length === 0 ? (
          <EmptyState
            title={t('receiving:no_results')}
            description={t('receiving:no_results_desc')}
          />
        ) : orderedVisibleColumns.length === 0 ? (
          <EmptyState
            title={t('receiving:no_results')}
            description={t('receiving:table.columns_hint')}
          />
        ) : (
          <TableScrollArea>
            <table className="w-full min-w-[64rem] border-collapse text-sm table-fixed">
              <colgroup>
                {orderedVisibleColumns.map((colId) => (
                  <col key={colId} style={{ width: receivingThWidth(colId) }} />
                ))}
              </colgroup>
              <thead className="bg-slate-50 dark:bg-slate-800/60">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  {orderedVisibleColumns.map((colId) => {
                    const label = columnOptions.find((c) => c.id === colId)?.label ?? colId
                    const alignRight = colId === 'qty' || colId === 'qoldiq'
                    return (
                      <th
                        key={colId}
                        className={`${TH_CLASS}${alignRight ? ' text-right' : ''}`}
                      >
                        {label}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {flatRows.map((row, rowIndex) => (
                  <tr
                    key={`${row.receiptId}-${row.lineId}`}
                    className={`border-b border-slate-100 dark:border-slate-800 ${
                      rowIndex % 2 === 1 ? 'bg-slate-50/50 dark:bg-slate-800/30' : ''
                    }`}
                  >
                    {orderedVisibleColumns.map((colId) => {
                      const alignRight = colId === 'qty' || colId === 'qoldiq'
                      return (
                        <td
                          key={colId}
                          className={`${TD_BASE}${alignRight ? ' text-right' : ''}`}
                        >
                          {renderReceivingCell(colId, row)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
        )}
        {!isLoading && totalReceipts > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
            <span className="text-sm text-slate-600 dark:text-slate-400">
              {t('receiving:pagination_range', {
                from: offset + 1,
                to: Math.min(offset + PAGE_SIZE, totalReceipts),
                total: totalReceipts,
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  const newOffset = Math.max(0, offset - PAGE_SIZE)
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev)
                    next.set('offset', String(newOffset))
                    return next
                  })
                }}
                disabled={offset === 0}
                className="gap-1"
              >
                <ChevronLeft size={16} />
                {t('receiving:prev_page')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev)
                    next.set('offset', String(offset + PAGE_SIZE))
                    return next
                  })
                }}
                disabled={offset + PAGE_SIZE >= totalReceipts}
                className="gap-1"
              >
                {t('receiving:next_page')}
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
        )}
      </Card>
      <ReceivingTableSettings
        open={isTableSettingsOpen}
        onOpenChange={setIsTableSettingsOpen}
        config={tableConfig}
        columns={columnOptions}
        onSave={updateTableConfig}
        onReset={resetTableConfig}
      />
    </AdminLayout>
  )
}
