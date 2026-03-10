import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { InventoryHeaderTabs } from '../../admin/components/inventory/InventoryHeaderTabs'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { TableSkeleton } from '../../components/ui/TableSkeleton'
import { getSmartupBalance } from '../../services/inventoryApi'

const HIDDEN_COLUMNS = new Set(['inventory_kind', 'product_id', 'batch_number', 'groups', 'warehouse_code', 'date'])
const NUMBER_COLUMNS = new Set(['quantity', 'input_price'])

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

/** Butun son, minglik ajratuvchi vergul (,) */
function formatNumber(value: unknown): string {
  if (value == null) return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n))
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
  const { t } = useTranslation(['inventory', 'common'])
  const [searchParams, setSearchParams] = useSearchParams()
  const searchQuery = searchParams.get('q') ?? ''
  const todayLabel = useMemo(
    () => new Date().toLocaleDateString('ru-RU'),
    []
  )
  const [data, setData] = useState<unknown>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(INITIAL_PAGE_SIZE)

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
  }, [searchQuery])

  const rawRows = useMemo(() => normalizeToRows(data), [data])

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return rawRows
    return rawRows.filter((row) =>
      Object.values(row).some((v) => v != null && String(v).toLowerCase().includes(q))
    )
  }, [rawRows, searchQuery])

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
                  <th
                    key={col}
                    className={`whitespace-nowrap px-3 py-3 ${NUMBER_COLUMNS.has(col.toLowerCase()) ? 'text-right tabular-nums' : 'text-left'}`}
                  >
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
                    <td
                      key={col}
                      className={`whitespace-nowrap px-3 py-3 text-slate-700 dark:text-slate-200 ${NUMBER_COLUMNS.has(col.toLowerCase()) ? 'text-right tabular-nums' : ''}`}
                    >
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
          <div className="flex flex-col gap-1 text-sm text-slate-800 dark:text-slate-100">
            <span className="font-semibold">Основной склад - НОВЫЙ</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{todayLabel}</span>
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-2 justify-end">
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
