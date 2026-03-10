import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Filter, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { InventoryHeaderTabs } from '../../admin/components/inventory/InventoryHeaderTabs'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { DateInput } from '../../components/DateInput'
import { EmptyState } from '../../components/ui/EmptyState'
import { TableSkeleton } from '../../components/ui/TableSkeleton'
import { getSmartupBalance } from '../../services/inventoryApi'

const HIDDEN_COLUMNS = new Set(['inventory_kind', 'product_id', 'batch_number', 'groups'])
const NUMBER_COLUMNS = new Set(['quantity', 'input_price'])

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
function daysAgoISO(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

/** API javobidan jadval uchun qatorlar ro'yxatini ajratib oladi. */
function normalizeToRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
  }
  if (data != null && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const key of ['balance', 'items', 'export', 'data', 'movement']) {
      const val = obj[key]
      if (Array.isArray(val)) {
        return val.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
      }
    }
  }
  return []
}

/** Birinchi qatordagi barcha key larni ustunlar sifatida qaytaradi (yashirilgan ustunlarsiz). */
function getColumns(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return []
  const first = rows[0]
  return Object.keys(first).filter(
    (k) =>
      first[k] !== undefined &&
      first[k] !== null &&
      !HIDDEN_COLUMNS.has(k.toLowerCase())
  )
}

function formatNumber(value: unknown): string {
  if (value == null) return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return new Intl.NumberFormat('uz-UZ', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)
}

function getCellDisplay(col: string, value: unknown): string {
  if (value == null) return '—'
  if (NUMBER_COLUMNS.has(col.toLowerCase())) return formatNumber(value)
  if (typeof value === 'object') return '—'
  return String(value)
}

const INITIAL_PAGE_SIZE = 50
const LOAD_MORE_SIZE = 50

export function SmartupBalancePage() {
  const { t } = useTranslation(['inventory', 'common', 'orders'])
  const [searchParams, setSearchParams] = useSearchParams()
  const searchQuery = searchParams.get('q') ?? ''
  const dateFrom = searchParams.get('date_from') ?? daysAgoISO(30)
  const dateTo = searchParams.get('date_to') ?? todayISO()
  const [data, setData] = useState<unknown>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(INITIAL_PAGE_SIZE)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [filterDateFrom, setFilterDateFrom] = useState(dateFrom)
  const [filterDateTo, setFilterDateTo] = useState(dateTo)
  const filterPanelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (forceRefresh = false) => {
    setIsLoading(true)
    setError(null)
    if (forceRefresh) setVisibleCount(INITIAL_PAGE_SIZE)
    try {
      const res = await getSmartupBalance({ refresh: forceRefresh })
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load(false)
  }, [load])

  useEffect(() => {
    setVisibleCount(INITIAL_PAGE_SIZE)
  }, [searchQuery, dateFrom, dateTo])

  const rawRows = useMemo(() => normalizeToRows(data), [data])

  const filteredRows = useMemo(() => {
    let list = rawRows
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter((row) =>
        Object.values(row).some((v) => v != null && String(v).toLowerCase().includes(q))
      )
    }
    const fromStr = dateFrom.trim() || daysAgoISO(30)
    const toStr = dateTo.trim() || todayISO()
    const dateKey = Object.keys(list[0] ?? {}).find((k) => k.toLowerCase() === 'date')
    if (dateKey) {
      list = list.filter((row) => {
        const cell = row[dateKey]
        if (cell == null) return true
        const str = String(cell).slice(0, 10)
        return str >= fromStr && str <= toStr
      })
    }
    return list
  }, [rawRows, searchQuery, dateFrom, dateTo])

  const allRows = filteredRows
  const rows = useMemo(
    () => allRows.slice(0, visibleCount),
    [allRows, visibleCount]
  )
  const hasMore = allRows.length > visibleCount
  const loadMore = useCallback(() => {
    setVisibleCount((n) => Math.min(n + LOAD_MORE_SIZE, allRows.length))
  }, [allRows.length])

  const columns = useMemo(() => getColumns(rawRows.length > 0 ? rawRows : rows), [rawRows, rows])

  useEffect(() => {
    if (filterPanelOpen) {
      setFilterDateFrom(dateFrom)
      setFilterDateTo(dateTo)
    }
  }, [filterPanelOpen, dateFrom, dateTo])

  const content = useMemo(() => {
    if (isLoading) {
      return <TableSkeleton rows={6} columns={5} />
    }
    if (error) {
      return (
        <EmptyState
          title={error}
          actionLabel={t('common:buttons.retry')}
          onAction={() => load(true)}
        />
      )
    }
    if (rawRows.length === 0) {
      return (
        <EmptyState
          title={t('inventory:smartup_balance_empty_title')}
          description={t('inventory:smartup_balance_empty_desc')}
          actionLabel={t('inventory:smartup_balance_load_btn')}
          onAction={() => load(true)}
        />
      )
    }
    if (rows.length === 0) {
      return (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {t('inventory:smartup_balance_no_results')}
        </p>
      )
    }
    return (
      <div className="flex flex-col gap-3">
        <TableScrollArea inline className="flex-1 min-h-0">
          <table className="w-max min-w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                {columns.map((col) => (
                  <th key={col} className="whitespace-nowrap px-3 py-3 text-left">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={idx}
                  className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
                >
{columns.map((col) => (
                  <td key={col} className="whitespace-nowrap px-3 py-3 text-slate-700 dark:text-slate-200">
                      {getCellDisplay(col, row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
        {hasMore && (
          <div className="flex justify-center pb-2">
            <Button variant="secondary" onClick={loadMore}>
              {t('inventory:smartup_balance_load_more')} ({visibleCount} / {allRows.length})
            </Button>
          </div>
        )}
      </div>
    )
  }, [columns, error, isLoading, load, rows, rawRows.length, allRows.length, visibleCount, hasMore, loadMore, t])

  return (
    <AdminLayout titleSlot={<InventoryHeaderTabs />}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) =>
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  const v = e.target.value.trim()
                  if (v) next.set('q', v)
                  else next.delete('q')
                  next.delete('offset')
                  return next
                })
              }
              placeholder={t('inventory:smartup_balance_search_placeholder')}
              className="max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
              aria-label={t('inventory:smartup_balance_search_placeholder')}
            />
            <div className="relative shrink-0" ref={filterPanelRef}>
              <Button
                variant="outline"
                onClick={() => setFilterPanelOpen((o) => !o)}
                className="gap-2"
                aria-label={t('orders:filters.filter_btn')}
                aria-expanded={filterPanelOpen}
              >
                <Filter size={18} />
                {t('orders:filters.filter_btn')}
              </Button>
              {filterPanelOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    aria-hidden
                    onClick={() => setFilterPanelOpen(false)}
                  />
                  <div className="absolute left-0 top-full z-50 mt-2 w-full min-w-[280px] max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {t('orders:filters.filter_panel_title')}
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
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-sm text-slate-600 dark:text-slate-400">
                          {t('orders:filters.date_from')}
                          <DateInput
                            value={filterDateFrom}
                            onChange={setFilterDateFrom}
                            className="mt-1 w-full"
                            aria-label={t('orders:filters.date_from')}
                          />
                        </label>
                        <label className="block text-sm text-slate-600 dark:text-slate-400">
                          {t('orders:filters.date_to')}
                          <DateInput
                            value={filterDateTo}
                            onChange={setFilterDateTo}
                            className="mt-1 w-full"
                            aria-label={t('orders:filters.date_to')}
                          />
                        </label>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
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
                      <Button
                        onClick={() => {
                          setSearchParams((prev) => {
                            const next = new URLSearchParams(prev)
                            const df = filterDateFrom.trim()
                            const dt = filterDateTo.trim()
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
                        {t('orders:filters.filter_apply')}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/admin/inventory">
              <Button variant="secondary">{t('inventory:back_to_summary')}</Button>
            </Link>
            <Button variant="secondary" onClick={() => load(true)} disabled={isLoading}>
              {t('common:buttons.refresh')}
            </Button>
          </div>
        </div>
        <div className="min-h-[min(70vh,600px)] max-h-[calc(100vh-220px)] flex flex-col overflow-auto">{content}</div>
      </Card>
    </AdminLayout>
  )
}
