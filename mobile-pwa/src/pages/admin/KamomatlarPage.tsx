import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileText, MinusCircle } from 'lucide-react'

import { useAuth } from '../../rbac/AuthProvider'
import { AdminLayout } from '../../admin/components/AdminLayout'
import { DateInput } from '../../components/DateInput'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { listAuditLogs } from '../../services/auditApi'
import type { AuditLogRecord } from '../../services/auditApi'
import { getProduct } from '../../services/productsApi'
import { getLocation } from '../../services/locationsApi'
import { listStockLots } from '../../services/inventoryApi'

const PAGE_SIZE = 50

type DetailResolved = {
  productName: string
  productCode: string
  barcode: string
  locationCode: string
  lotBatch: string
  qtyChange: number
  movementType: string
}

/** Inventarizatsiya tarixi: faqat stock_movement (mahsulot qo'shish/yo'q qilish va mobil inventar o'zgarishlari). */
export function KamomatlarPage() {
  const { t } = useTranslation(['kamomat', 'common'])
  const { has } = useAuth()
  const canWriteOff = has('inventory:adjust')
  const [items, setItems] = useState<AuditLogRecord[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailRow, setDetailRow] = useState<AuditLogRecord | null>(null)
  const [detailResolved, setDetailResolved] = useState<DetailResolved | null>(null)
  const [detailResolveLoading, setDetailResolveLoading] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await listAuditLogs({
        entity_type: 'stock_movement',
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kamomat:load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [dateFrom, dateTo, offset, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!detailRow || detailRow.entity_type !== 'stock_movement') {
      setDetailResolved(null)
      return
    }
    const data = detailRow.new_data ?? detailRow.old_data
    const productId = data?.product_id as string | undefined
    const lotId = data?.lot_id as string | undefined
    const locationId = data?.location_id as string | undefined
    const qtyChange = data?.qty_change != null ? Number(data.qty_change) : 0
    const movementType = (data?.movement_type as string) ?? '—'
    if (!productId || !locationId) {
      setDetailResolved(null)
      return
    }
    setDetailResolveLoading(true)
    setDetailResolved(null)
    Promise.all([
      getProduct(productId).catch(() => null),
      getLocation(locationId).then((l) => l.code ?? locationId).catch(() => locationId),
      listStockLots(productId)
        .then((lots) => lots.find((l) => l.id === lotId)?.batch ?? (lotId ? lotId.slice(0, 8) : '—'))
        .catch(() => lotId ? lotId.slice(0, 8) : '—'),
    ])
      .then(([product, locationCode, lotBatch]) => {
        const productName = product?.name ?? product?.sku ?? productId
        const productCode = product?.sku ?? '—'
        const barcode = product?.barcode ?? product?.barcodes?.[0] ?? '—'
        setDetailResolved({
          productName: String(productName),
          productCode: String(productCode),
          barcode: String(barcode),
          locationCode: String(locationCode),
          lotBatch: String(lotBatch),
          qtyChange,
          movementType,
        })
      })
      .finally(() => setDetailResolveLoading(false))
  }, [detailRow])

  const handleApply = () => {
    setOffset(0)
    void load()
  }

  const formatJson = (obj: Record<string, unknown> | null) => {
    if (!obj || Object.keys(obj).length === 0) return '—'
    try {
      return JSON.stringify(obj, null, 2)
    } catch {
      return String(obj)
    }
  }

  /** Harakat ID (stock_movement) qisqacha ko'rsatish */
  const movementLabel = (entityId: string) => entityId.slice(0, 8)

  const content = () => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
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
    return (
      <TableScrollArea>
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('kamomat:columns.date')}</th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('kamomat:columns.user')}</th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('kamomat:columns.action')}</th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('kamomat:columns.movement')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                onClick={() => setDetailRow(row)}
              >
                <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300 sm:px-4">
                  {new Date(row.created_at).toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-700 dark:text-slate-200 sm:px-4">
                  {row.username ?? row.user_id ?? '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-3 sm:px-4">
                  <span
                    className={
                      row.action === 'CREATE'
                        ? 'rounded bg-green-100 px-1.5 py-0.5 text-green-800 dark:bg-green-900/50 dark:text-green-200'
                        : row.action === 'DELETE'
                          ? 'rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-900/50 dark:text-red-200'
                          : 'rounded bg-blue-100 px-1.5 py-0.5 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200'
                    }
                  >
                    {row.action}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-800 dark:text-slate-200 sm:px-4">
                  {movementLabel(row.entity_id)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }

  return (
    <AdminLayout title={t('kamomat:title')}>
      {canWriteOff && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/admin/kamomat/yoq-qilish"
            className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-900/50"
          >
            <MinusCircle size={18} />
            {t('kamomat:write_off_button')}
          </Link>
        </div>
      )}
      <Card className="mb-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('kamomat:filters.date_from')}
            <DateInput
              value={dateFrom}
              onChange={setDateFrom}
              className="mt-1 w-full"
              aria-label={t('kamomat:filters.date_from')}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('kamomat:filters.date_to')}
            <DateInput
              value={dateTo}
              onChange={setDateTo}
              className="mt-1 w-full"
              aria-label={t('kamomat:filters.date_to')}
            />
          </label>
          <div className="flex items-end">
            <Button onClick={handleApply}>{t('kamomat:filters.apply')}</Button>
          </div>
        </div>
      </Card>
      <Card className="space-y-4">{content()}</Card>
      <div className="mt-4 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
        <span>{t('kamomat:total', { count: total })}</span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset((p) => Math.max(0, p - PAGE_SIZE))}
          >
            {t('common:buttons.back')}
          </Button>
          <Button
            variant="secondary"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((p) => p + PAGE_SIZE)}
          >
            {t('common:buttons.next')}
          </Button>
        </div>
      </div>

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
              {detailRow.action} • {movementLabel(detailRow.entity_id)}
            </h3>
            <dl className="mb-4 space-y-2 text-sm">
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.who')}:</span>
                <span className="text-slate-800 dark:text-slate-200">{detailRow.username ?? '—'}</span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.when')}:</span>
                <span className="text-slate-800 dark:text-slate-200">
                  {new Date(detailRow.created_at).toLocaleString()}
                </span>
              </div>
              {detailRow.ip_address && (
                <div className="flex flex-wrap gap-x-2">
                  <span className="font-medium text-slate-500 dark:text-slate-400">IP:</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">{detailRow.ip_address}</span>
                </div>
              )}
            </dl>
            {detailResolveLoading && (
              <p className="mb-4 text-sm text-slate-500">{t('kamomat:detail.loading')}</p>
            )}
            {detailResolved && !detailResolveLoading && (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
                <h4 className="mb-3 text-sm font-medium text-slate-600 dark:text-slate-400">
                  {t('kamomat:detail.summary')}
                </h4>
                <dl className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.product')}: </span>
                    <span className="text-slate-800 dark:text-slate-200">{detailResolved.productName}</span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.product_code')}: </span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">{detailResolved.productCode}</span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.barcode')}: </span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">{detailResolved.barcode}</span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.batch')}: </span>
                    <span className="text-slate-800 dark:text-slate-200">{detailResolved.lotBatch}</span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.location')}: </span>
                    <span className="text-slate-800 dark:text-slate-200">{detailResolved.locationCode}</span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.qty_change')}: </span>
                    <span
                      className={
                        detailResolved.qtyChange < 0
                          ? 'font-medium text-amber-600 dark:text-amber-400'
                          : 'text-slate-800 dark:text-slate-200'
                      }
                    >
                      {detailResolved.qtyChange > 0 ? '+' : ''}{detailResolved.qtyChange}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.action_type')}: </span>
                    <span className="text-slate-800 dark:text-slate-200">{detailResolved.movementType}</span>
                  </div>
                </dl>
              </div>
            )}
            <details className="mb-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-400">
                {t('kamomat:detail.raw_data')}
              </summary>
              <div className="mt-2 grid gap-4 md:grid-cols-2">
                <div>
                  <h4 className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t('kamomat:detail.old_data')}
                  </h4>
                  <pre className="max-h-48 overflow-auto rounded-xl bg-slate-100 p-3 font-mono text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
                    {formatJson(detailRow.old_data)}
                  </pre>
                </div>
                <div>
                  <h4 className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t('kamomat:detail.new_data')}
                  </h4>
                  <pre className="max-h-48 overflow-auto rounded-xl bg-slate-100 p-3 font-mono text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
                    {formatJson(detailRow.new_data)}
                  </pre>
                </div>
              </div>
            </details>
            <Button className="mt-4" variant="secondary" onClick={() => setDetailRow(null)}>
              {t('common:buttons.close')}
            </Button>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
