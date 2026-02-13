import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getProducts, type Product } from '../../services/productsApi'
import { getLocations, type Location } from '../../services/locationsApi'
import {
  createReceipt,
  listReceipts,
  completeReceipt,
  type Receipt,
  type ReceiptLineCreate,
} from '../../services/receivingApi'
import { useAuth } from '../../rbac/AuthProvider'

type LineDraft = ReceiptLineCreate & { id: string }

const EMPTY_LINE: LineDraft = {
  id: 'line-0',
  product_id: '',
  qty: 1,
  batch: '',
  expiry_date: null,
  location_id: '',
}

export function ReceivingPage() {
  const { t } = useTranslation(['receiving', 'common'])
  const navigate = useNavigate()
  const { has } = useAuth()
  const canWrite = has('receiving:write')

  const [products, setProducts] = useState<Product[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [docNo, setDocNo] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [productsResponse, locationsResponse, receiptsResponse] = await Promise.all([
        getProducts({ limit: 200 }),
        getLocations(true),
        listReceipts(),
      ])
      setProducts(productsResponse.items)
      setLocations(locationsResponse)
      setReceipts(receiptsResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receiving:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const productLookup = useMemo(() => {
    const map = new Map(products.map((product) => [product.id, product]))
    return map
  }, [products])

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

  const handleSubmit = async () => {
    if (!canWrite) return
    if (!lines.length) {
      setError(t('receiving:validation.lines_required'))
      return
    }
    const invalid = lines.some(
      (line) => !line.product_id || !line.location_id || !line.batch.trim() || line.qty <= 0
    )
    if (invalid) {
      setError(t('receiving:validation.line_invalid'))
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await createReceipt({
        doc_no: docNo.trim() || undefined,
        lines: lines.map(({ id, ...line }) => ({
          ...line,
          batch: line.batch.trim(),
          expiry_date: line.expiry_date || null,
        })),
      })
      setDocNo('')
      setLines([{ ...EMPTY_LINE }])
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receiving:save_failed'))
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

  return (
    <AdminLayout title={t('receiving:title')}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            className="-ml-2 shrink-0 gap-2"
            onClick={() => navigate(-1)}
            aria-label={t('common:buttons.back')}
          >
            <ArrowLeft size={20} />
            <span>{t('common:buttons.back')}</span>
          </Button>
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('receiving:create_title')}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t('receiving:create_subtitle')}
            </div>
          </div>
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

        <div className="space-y-3">
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
                  <select
                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                    value={line.product_id}
                    onChange={(event) => updateLine(line.id, { product_id: event.target.value })}
                  >
                    <option value="">{t('receiving:fields.select_product')}</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.sku} · {product.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-600 dark:text-slate-300">
                  {t('receiving:fields.location')}
                  <select
                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                    value={line.location_id}
                    onChange={(event) => updateLine(line.id, { location_id: event.target.value })}
                  >
                    <option value="">{t('receiving:fields.select_location')}</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.code} · {location.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-600 dark:text-slate-300">
                  {t('receiving:fields.qty')}
                  <input
                    type="number"
                    min={0}
                    step={0.001}
                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                    value={line.qty}
                    onChange={(event) => updateLine(line.id, { qty: Number(event.target.value) })}
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
      </Card>

      <Card className="mt-6 space-y-4">
        <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('receiving:list_title')}
        </div>
        {isLoading ? (
          <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
        ) : receipts.length === 0 ? (
          <EmptyState title={t('receiving:empty')} description={t('receiving:empty_desc')} />
        ) : (
          <div className="space-y-3">
            {receipts.map((receipt) => (
              <div
                key={receipt.id}
                className="rounded-2xl border border-slate-200 p-4 text-sm dark:border-slate-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {receipt.doc_no}
                    </div>
                    <div className="text-xs text-slate-500">
                      {t('receiving:status')}: {t(`receiving:statuses.${receipt.status}`)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">
                      {t('receiving:lines_count', { count: receipt.lines.length })}
                    </span>
                    {receipt.status === 'draft' ? (
                      <Button
                        onClick={() => handleComplete(receipt.id)}
                        disabled={!canWrite || isSubmitting}
                      >
                        {t('receiving:complete')}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-300">
                  {receipt.lines.map((line) => {
                    const product = productLookup.get(line.product_id)
                    const location = locationLookup.get(line.location_id)
                    return (
                      <div key={line.id} className="flex flex-wrap gap-2">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {product ? `${product.sku} · ${product.name}` : line.product_id}
                        </span>
                        <span>
                          {t('receiving:fields.qty')}: {line.qty}
                        </span>
                        <span>
                          {t('receiving:fields.batch')}: {line.batch}
                        </span>
                        <span>
                          {t('receiving:fields.expiry_date')}: {line.expiry_date ?? '—'}
                        </span>
                        <span>
                          {t('receiving:fields.location')}:{' '}
                          {location ? `${location.code}` : line.location_id}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </AdminLayout>
  )
}
