import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileText, Filter, MinusCircle, X } from 'lucide-react'

import { useAuth } from '../../rbac/AuthProvider'
import { AdminLayout } from '../../admin/components/AdminLayout'
import { DateInput } from '../../components/DateInput'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { TableSkeleton } from '../../components/ui/TableSkeleton'
import { getInventoryMovements, type InventoryMovement } from '../../services/inventoryApi'

const PAGE_SIZE = 50

/** Inventarizatsiya (Hujjatlar tarixi): barcha ombor harakatlari — Ko'chirish jadvali formatida. */
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
  const [error, setError] = useState<string | null>(null)
  const [detailRow, setDetailRow] = useState<InventoryMovement | null>(null)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const filterPanelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getInventoryMovements({
        date_from: filterDateFrom.trim() || undefined,
        date_to: filterDateTo.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setItems(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kamomat:load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [filterDateFrom, filterDateTo, offset, t])

  useEffect(() => {
    void load()
  }, [load])

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return items
    return items.filter((row) => {
      const product = [row.product_code, row.product_name].filter(Boolean).join(' ').toLowerCase()
      const batch = (row.batch ?? row.lot_id ?? '').toString().toLowerCase()
      const location = (row.location_code ?? row.location_id ?? '').toString().toLowerCase()
      const who = (row.created_by_username ?? row.created_by_user_id ?? '').toString().toLowerCase()
      return product.includes(q) || batch.includes(q) || location.includes(q) || who.includes(q)
    })
  }, [items, searchQuery])

  const hasNextPage = items.length >= PAGE_SIZE
  const pageStart = offset + 1
  const pageEnd = offset + items.length

  const content = () => {
    if (isLoading) {
      return (
        <div className="relative flex-1 min-h-[200px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
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
    if (filteredItems.length === 0) {
      return (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {t('admin:movement_page.search_no_results')}
        </p>
      )
    }
    return (
      <TableScrollArea>
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-4 py-3 text-left">{t('inventory:columns.movement_type')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.qty')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.product')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.lot')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.location')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.created_by')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.created_at')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                onClick={() => setDetailRow(row)}
              >
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.reason_code === 'inventory_overage'
                    ? t('admin:movement_page.reason_overage')
                    : row.reason_code === 'inventory_shortage'
                      ? t('admin:movement_page.reason_shortage')
                      : t(`inventory:movement_types.${row.movement_type}`, row.movement_type)}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.qty_change > 0 ? '+' : ''}{Math.round(Number(row.qty_change))}
                </td>
                <td className="max-w-[200px] px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.product_code != null || row.product_name != null ? (
                    <span className="block truncate" title={row.product_name ?? undefined}>
                      {[row.product_code, row.product_name].filter(Boolean).join(' — ')}
                    </span>
                  ) : (
                    row.product_id
                  )}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.batch ?? row.lot_id}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.location_code ?? row.location_id}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.created_by_username ?? row.created_by_user_id ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(row.created_at).toLocaleString()}
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
          <label className="flex-1 min-w-[180px] max-w-md text-sm text-slate-600 dark:text-slate-300">
            <span className="sr-only">{t('admin:movement_page.search_placeholder')}</span>
            <input
              type="search"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('admin:movement_page.search_placeholder')}
            />
          </label>
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
                      }}
                    >
                      {t('inventory:filters.apply')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        {content()}
        {items.length > 0 && (
          <div className="flex items-center justify-end gap-2 pt-2">
            <span className="mr-auto text-sm text-slate-600 dark:text-slate-400">
              {pageStart}–{pageEnd}
              {hasNextPage ? '+' : ''}
            </span>
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset((p) => Math.max(0, p - PAGE_SIZE))}
            >
              {t('common:buttons.back')}
            </Button>
            <Button
              variant="secondary"
              disabled={!hasNextPage}
              onClick={() => setOffset((p) => p + PAGE_SIZE)}
            >
              {t('common:buttons.next')}
            </Button>
          </div>
        )}
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
                <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.product')}:</span>
                <span className="text-slate-800 dark:text-slate-200">
                  {[detailRow.product_code, detailRow.product_name].filter(Boolean).join(' — ') || detailRow.product_id}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.batch')}:</span>
                <span className="text-slate-800 dark:text-slate-200">{detailRow.batch ?? detailRow.lot_id}</span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.location')}:</span>
                <span className="text-slate-800 dark:text-slate-200">{detailRow.location_code ?? detailRow.location_id}</span>
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
                  {Number(detailRow.qty_change) > 0 ? '+' : ''}{Math.round(Number(detailRow.qty_change))}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-500 dark:text-slate-400">{t('kamomat:detail.action_type')}:</span>
                <span className="text-slate-800 dark:text-slate-200">
                  {detailRow.reason_code === 'inventory_overage'
                    ? t('admin:movement_page.reason_overage')
                    : detailRow.reason_code === 'inventory_shortage'
                      ? t('admin:movement_page.reason_shortage')
                      : t(`inventory:movement_types.${detailRow.movement_type}`, detailRow.movement_type)}
                </span>
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
