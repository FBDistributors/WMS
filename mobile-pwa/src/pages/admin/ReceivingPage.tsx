import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { ProductSearchCombobox, formatProductLabel } from '../../components/ProductSearchCombobox'
import { LocationSearchCombobox, formatLocationLabel } from '../../components/LocationSearchCombobox'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { TableScrollArea } from '../../components/TableScrollArea'
import { getProducts, type Product } from '../../services/productsApi'
import { getLocations, type Location } from '../../services/locationsApi'
import {
  createReceipt,
  listReceipts,
  completeReceipt,
  type Receipt,
  type ReceiptLineCreate,
  type ReceiptStatus,
} from '../../services/receivingApi'
import { useAuth } from '../../rbac/AuthProvider'

type LineDraft = Omit<ReceiptLineCreate, 'qty'> & { id: string; qty: number | '' }

const EMPTY_LINE: LineDraft = {
  id: 'line-0',
  product_id: '',
  qty: '',
  batch: '',
  expiry_date: null,
  location_id: '',
}

function formatReceiptDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function ReceivingPage() {
  const { t } = useTranslation(['receiving', 'common'])
  const { has } = useAuth()
  const canWrite = has('receiving:write')

  const [products, setProducts] = useState<Product[]>([])
  const [selectedProducts, setSelectedProducts] = useState<Map<string, Product>>(new Map())
  const [locations, setLocations] = useState<Location[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ReceiptStatus | 'all'>('all')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [docNo, setDocNo] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const statusParam =
        statusFilter === 'all' ? undefined : (statusFilter as ReceiptStatus)
      const [locationsResponse, receiptsResponse] = await Promise.all([
        getLocations(false),
        listReceipts(statusParam),
      ])
      setLocations(locationsResponse)
      setReceipts(receiptsResponse)

      const productIds = [
        ...new Set(
          receiptsResponse.flatMap((r) => r.lines.map((l) => l.product_id).filter(Boolean))
        ),
      ]
      if (productIds.length > 0) {
        const productsResponse = await getProducts({
          product_ids: productIds,
          limit: productIds.length,
        })
        setProducts(productsResponse.items)
      } else {
        setProducts([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receiving:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [t, statusFilter])

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

  const productLookup = useMemo(() => {
    const map = new Map<string, Product>(products.map((p) => [p.id, p]))
    selectedProducts.forEach((p) => map.set(p.id, p))
    return map
  }, [products, selectedProducts])

  const locationLookup = useMemo(() => {
    const map = new Map(locations.map((location) => [location.id, location]))
    return map
  }, [locations])

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

  const handleComplete = async (receiptId: string) => {
    if (!canWrite) return
    setIsSubmitting(true)
    setError(null)
    try {
      await completeReceipt(receiptId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receiving:complete_failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

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
                    const raw = event.target.value
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
                <input
                  type="date"
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                  value={line.expiry_date ?? ''}
                  onChange={(event) =>
                    updateLine(line.id, { expiry_date: event.target.value || null })
                  }
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
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                aria-label={t('receiving:search_placeholder')}
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter((e.target.value === 'all' ? 'all' : e.target.value) as ReceiptStatus | 'all')
              }
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              aria-label={t('receiving:filter_status')}
            >
              <option value="all">{t('receiving:filter_all')}</option>
              <option value="draft">{t('receiving:statuses.draft')}</option>
              <option value="completed">{t('receiving:statuses.completed')}</option>
              <option value="cancelled">{t('receiving:statuses.cancelled')}</option>
            </select>
          </div>
        </div>
        {isLoading ? (
          <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
        ) : receipts.length === 0 ? (
          <EmptyState title={t('receiving:empty')} description={t('receiving:empty_desc')} />
        ) : filteredReceipts.length === 0 ? (
          <EmptyState
            title={t('receiving:no_results')}
            description={t('receiving:no_results_desc')}
          />
        ) : (
          <TableScrollArea>
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:col_doc_no')}
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:col_status')}
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:col_received_by')}
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:col_received_at')}
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:col_lines')}
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:col_actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredReceipts.map((receipt) => (
                  <tr
                    key={receipt.id}
                    className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="py-2.5 px-2 text-slate-900 dark:text-slate-100 font-medium">
                      {receipt.doc_no}
                    </td>
                    <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300">
                      {t(`receiving:statuses.${receipt.status}`)}
                    </td>
                    <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300">
                      {receipt.created_by_username ?? '—'}
                    </td>
                    <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {receipt.created_at ? formatReceiptDate(receipt.created_at) : '—'}
                    </td>
                    <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300">
                      {t('receiving:lines_count', { count: receipt.lines.length })}
                    </td>
                    <td className="py-2.5 px-2">
                      {receipt.status === 'draft' ? (
                        <Button
                          className="py-2 px-3 text-xs"
                          onClick={() => handleComplete(receipt.id)}
                          disabled={!canWrite || isSubmitting}
                        >
                          {t('receiving:complete')}
                        </Button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
        )}
      </Card>
    </AdminLayout>
  )
}
