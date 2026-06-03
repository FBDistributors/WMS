import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Filter, Search, X } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { DateInput } from '../../components/DateInput'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import { getWarehouseTransfers, type WarehouseTransfer } from '../../services/inventoryApi'

const PAGE_SIZE = 50

/** Admin Ko'chirish: joydan-joyga o'tkazmalar jadvali (Qabul uslubi). */
export function MovementPage() {
  const { t } = useTranslation(['admin', 'common', 'inventory', 'kamomat'])
  const [searchParams, setSearchParams] = useSearchParams()
  const searchQuery = searchParams.get('q') ?? ''
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10))

  const [filterDateFrom, setFilterDateFrom] = useState(dateFrom)
  const [filterDateTo, setFilterDateTo] = useState(dateTo)
  const [items, setItems] = useState<WarehouseTransfer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { showError } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)
  const [detailRow, setDetailRow] = useState<WarehouseTransfer | null>(null)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const filterPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!filterPanelOpen) return
    setFilterDateFrom(dateFrom)
    setFilterDateTo(dateTo)
  }, [filterPanelOpen, dateFrom, dateTo])

  const load = useCallback(async () => {
    setIsLoading(true)
    setHasLoadError(false)
    try {
      const data = await getWarehouseTransfers({
        date_from: dateFrom.trim() || undefined,
        date_to: dateTo.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setItems(data)
    } catch (err) {
      showError(err instanceof Error ? err.message : t('inventory:load_failed'))
      setHasLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }, [dateFrom, dateTo, offset, showError, t])

  useEffect(() => {
    void load()
  }, [load])

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return items
    return items.filter((row) => {
      const product = [row.product_code, row.product_name].filter(Boolean).join(' ').toLowerCase()
      const batch = (row.batch ?? row.lot_id ?? '').toString().toLowerCase()
      const fromLoc = (row.from_location_code ?? row.from_location_id ?? '').toString().toLowerCase()
      const toLoc = (row.to_location_code ?? row.to_location_id ?? '').toString().toLowerCase()
      const who = (row.created_by_username ?? row.created_by_user_id ?? '').toString().toLowerCase()
      return (
        product.includes(q) ||
        batch.includes(q) ||
        fromLoc.includes(q) ||
        toLoc.includes(q) ||
        who.includes(q)
      )
    })
  }, [items, searchQuery])

  const hasNextPage = items.length >= PAGE_SIZE
  const pageStart = items.length > 0 ? offset + 1 : 0
  const pageEnd = offset + items.length

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
  }

  const content = () => {
    if (isLoading) {
      return (
        <div className="relative min-h-[200px] flex-1">
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
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('admin:movement_page.empty_transfers')}
          description={t('admin:movement_page.empty_transfers_desc')}
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
          <thead className="sticky top-0 z-10 bg-white text-xs uppercase text-slate-500 dark:bg-slate-900">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-4 py-3 text-left">{t('admin:movement_page.from')}</th>
              <th className="px-2 py-3 text-center" aria-hidden />
              <th className="px-4 py-3 text-left">{t('admin:movement_page.to')}</th>
              <th className="px-4 py-3 text-left">{t('admin:movement_page.qty')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.product')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.lot')}</th>
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
                <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">
                  {row.from_location_code ?? row.from_location_id}
                </td>
                <td className="px-2 py-3 text-slate-400">
                  <ArrowRight size={16} className="mx-auto" aria-hidden />
                </td>
                <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">
                  {row.to_location_code ?? row.to_location_id}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {Math.round(Number(row.qty))}
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
              onClick={() => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  const nextOffset = Math.max(0, offset - PAGE_SIZE)
                  if (nextOffset > 0) next.set('offset', String(nextOffset))
                  else next.delete('offset')
                  return next
                })
              }}
            >
              {t('common:buttons.back')}
            </Button>
            <Button
              variant="secondary"
              disabled={!hasNextPage}
              onClick={() => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  next.set('offset', String(offset + PAGE_SIZE))
                  return next
                })
              }}
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
                  {t('kamomat:detail.product')}:
                </span>
                <span className="text-slate-800 dark:text-slate-200">
                  {[detailRow.product_code, detailRow.product_name].filter(Boolean).join(' — ') ||
                    detailRow.product_id}
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
