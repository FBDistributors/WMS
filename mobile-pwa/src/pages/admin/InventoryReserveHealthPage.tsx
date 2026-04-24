import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, RefreshCcw, ShieldAlert } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { InventoryHeaderTabs } from '../../admin/components/inventory/InventoryHeaderTabs'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import {
  getInventorySummary,
  getNegativeBalanceCheck,
  getReserveByOrder,
  type InventorySummaryRow,
  type NegativeBalanceRow,
  type ReserveByOrderRow,
  type WarehouseFilter,
} from '../../services/inventoryApi'

type SegmentMode = 'reserved' | 'negative'

type SortDir = 'asc' | 'desc'

type ReservedSortKey =
  | 'code'
  | 'product'
  | 'order'
  | 'reserved_qty'
  | 'created_by'
  | 'last_movement_at'
  | 'available_total'

type NegativeSortKey = 'code' | 'location' | 'lot' | 'batch' | 'on_hand' | 'reserved' | 'available'

type SortState<K extends string> = { key: K; dir: SortDir } | null

const NEGATIVE_LIMIT = 500

function compareReservedRows(
  a: ReserveByOrderRow,
  b: ReserveByOrderRow,
  key: ReservedSortKey,
  availableByProductId: Map<string, number>,
): number {
  switch (key) {
    case 'code':
      return a.product_code.localeCompare(b.product_code, undefined, { sensitivity: 'base' })
    case 'product':
      return a.product_name.localeCompare(b.product_name, undefined, { sensitivity: 'base' })
    case 'order':
      return (a.order_number ?? '').localeCompare(b.order_number ?? '', undefined, {
        sensitivity: 'base',
        numeric: true,
      })
    case 'reserved_qty':
      return Number(a.reserved_qty) - Number(b.reserved_qty)
    case 'created_by':
      return (a.last_movement_by_username ?? '').localeCompare(b.last_movement_by_username ?? '', undefined, {
        sensitivity: 'base',
      })
    case 'last_movement_at':
      return new Date(a.last_movement_at).getTime() - new Date(b.last_movement_at).getTime()
    case 'available_total': {
      const hasA = availableByProductId.has(a.product_id)
      const hasB = availableByProductId.has(b.product_id)
      if (!hasA && !hasB) return 0
      if (!hasA) return 1
      if (!hasB) return -1
      return (availableByProductId.get(a.product_id) ?? 0) - (availableByProductId.get(b.product_id) ?? 0)
    }
    default:
      return 0
  }
}

function compareNegativeRows(a: NegativeBalanceRow, b: NegativeBalanceRow, key: NegativeSortKey): number {
  switch (key) {
    case 'code':
      return (a.sku ?? '').localeCompare(b.sku ?? '', undefined, { sensitivity: 'base' })
    case 'location':
      return a.location_code.localeCompare(b.location_code, undefined, { sensitivity: 'base' })
    case 'lot':
      return String(a.lot_id).localeCompare(String(b.lot_id))
    case 'batch':
      return a.batch.localeCompare(b.batch, undefined, { sensitivity: 'base' })
    case 'on_hand':
      return Number(a.on_hand) - Number(b.on_hand)
    case 'reserved':
      return Number(a.reserved) - Number(b.reserved)
    case 'available':
      return Number(a.available) - Number(b.available)
    default:
      return 0
  }
}

function SortTh<K extends string>({
  columnKey,
  sortState,
  onSort,
  label,
  ariaSortLabelAsc,
  ariaSortLabelDesc,
}: {
  columnKey: K
  sortState: SortState<K>
  onSort: (key: K) => void
  label: string
  ariaSortLabelAsc: string
  ariaSortLabelDesc: string
}) {
  const active = sortState?.key === columnKey
  const dir = sortState?.dir
  const ariaSort = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
  const ariaLabel = active
    ? dir === 'asc'
      ? `${label}. ${ariaSortLabelDesc}`
      : `${label}. ${ariaSortLabelAsc}`
    : `${label}. ${ariaSortLabelAsc}`

  return (
    <th className="px-3 py-2" aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className="inline-flex max-w-full items-center gap-1 rounded-md text-left font-semibold uppercase tracking-wide text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        aria-label={ariaLabel}
      >
        <span className="min-w-0 truncate">{label}</span>
        {active ? (
          dir === 'asc' ? (
            <ArrowUp className="shrink-0 opacity-90" size={14} aria-hidden />
          ) : (
            <ArrowDown className="shrink-0 opacity-90" size={14} aria-hidden />
          )
        ) : (
          <ArrowUpDown className="shrink-0 opacity-35" size={14} aria-hidden />
        )}
      </button>
    </th>
  )
}

export function InventoryReserveHealthPage() {
  const { t } = useTranslation(['inventory', 'common'])
  const [searchParams, setSearchParams] = useSearchParams()
  const warehouse: WarehouseFilter = (searchParams.get('warehouse') as WarehouseFilter) || 'main'
  const [segment, setSegment] = useState<SegmentMode>('reserved')
  const [search, setSearch] = useState('')
  const [reservedByOrderRows, setReservedByOrderRows] = useState<ReserveByOrderRow[]>([])
  const [availableByProductId, setAvailableByProductId] = useState<Map<string, number>>(new Map())
  const [negativeRows, setNegativeRows] = useState<NegativeBalanceRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reservedSort, setReservedSort] = useState<SortState<ReservedSortKey>>(null)
  const [negativeSort, setNegativeSort] = useState<SortState<NegativeSortKey>>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [byOrder, summary, negative] = await Promise.all([
        getReserveByOrder({ warehouse }),
        getInventorySummary({ warehouse }),
        getNegativeBalanceCheck({ warehouse, limit: NEGATIVE_LIMIT }),
      ])
      setReservedByOrderRows(byOrder.items)
      const avail = new Map<string, number>()
      for (const row of summary as InventorySummaryRow[]) {
        avail.set(row.product_id, Number(row.available_total))
      }
      setAvailableByProductId(avail)
      setNegativeRows(negative.rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory:load_failed'))
      setReservedByOrderRows([])
      setAvailableByProductId(new Map())
      setNegativeRows([])
    } finally {
      setIsLoading(false)
    }
  }, [t, warehouse])

  useEffect(() => {
    void load()
  }, [load])

  const toggleReservedSort = useCallback((key: ReservedSortKey) => {
    setReservedSort((prev) => ({
      key,
      dir: prev?.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }, [])

  const toggleNegativeSort = useCallback((key: NegativeSortKey) => {
    setNegativeSort((prev) => ({
      key,
      dir: prev?.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }, [])

  const normalizedSearch = search.trim().toLowerCase()

  const reservedProductCount = useMemo(() => {
    return new Set(reservedByOrderRows.map((r) => r.product_id)).size
  }, [reservedByOrderRows])

  const filteredReserved = useMemo(() => {
    if (!normalizedSearch) return reservedByOrderRows
    return reservedByOrderRows.filter((row) => {
      const orderNo = (row.order_number ?? '').toLowerCase()
      return (
        row.product_code.toLowerCase().includes(normalizedSearch) ||
        row.product_name.toLowerCase().includes(normalizedSearch) ||
        orderNo.includes(normalizedSearch)
      )
    })
  }, [normalizedSearch, reservedByOrderRows])

  const filteredNegative = useMemo(() => {
    if (!normalizedSearch) return negativeRows
    return negativeRows.filter((row) => {
      const sku = (row.sku ?? '').toLowerCase()
      return (
        sku.includes(normalizedSearch) ||
        row.location_code.toLowerCase().includes(normalizedSearch) ||
        row.batch.toLowerCase().includes(normalizedSearch)
      )
    })
  }, [negativeRows, normalizedSearch])

  const sortedReserved = useMemo(() => {
    if (!reservedSort) return filteredReserved
    const { key, dir } = reservedSort
    const mult = dir === 'asc' ? 1 : -1
    return [...filteredReserved].sort((a, b) => mult * compareReservedRows(a, b, key, availableByProductId))
  }, [availableByProductId, filteredReserved, reservedSort])

  const sortedNegative = useMemo(() => {
    if (!negativeSort) return filteredNegative
    const { key, dir } = negativeSort
    const mult = dir === 'asc' ? 1 : -1
    return [...filteredNegative].sort((a, b) => mult * compareNegativeRows(a, b, key))
  }, [filteredNegative, negativeSort])

  const ariaAsc = t('inventory:reserve_health.sort_aria_asc')
  const ariaDesc = t('inventory:reserve_health.sort_aria_desc')

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="relative min-h-[320px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
    }
    if (error) {
      return (
        <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
      )
    }

    if (segment === 'reserved') {
      if (sortedReserved.length === 0) {
        return (
          <EmptyState
            title={t('inventory:reserve_health.reserved_empty_title')}
            description={t('inventory:reserve_health.reserved_empty_desc')}
            actionLabel={t('common:buttons.refresh')}
            onAction={load}
          />
        )
      }
      return (
        <div className="overflow-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <SortTh
                  columnKey="code"
                  sortState={reservedSort}
                  onSort={toggleReservedSort}
                  label={t('inventory:columns.code')}
                  ariaSortLabelAsc={ariaAsc}
                  ariaSortLabelDesc={ariaDesc}
                />
                <SortTh
                  columnKey="product"
                  sortState={reservedSort}
                  onSort={toggleReservedSort}
                  label={t('inventory:columns.product')}
                  ariaSortLabelAsc={ariaAsc}
                  ariaSortLabelDesc={ariaDesc}
                />
                <SortTh
                  columnKey="order"
                  sortState={reservedSort}
                  onSort={toggleReservedSort}
                  label={t('inventory:columns.order')}
                  ariaSortLabelAsc={ariaAsc}
                  ariaSortLabelDesc={ariaDesc}
                />
                <SortTh
                  columnKey="reserved_qty"
                  sortState={reservedSort}
                  onSort={toggleReservedSort}
                  label={t('inventory:reserve_health.reserved_qty_order')}
                  ariaSortLabelAsc={ariaAsc}
                  ariaSortLabelDesc={ariaDesc}
                />
                <SortTh
                  columnKey="created_by"
                  sortState={reservedSort}
                  onSort={toggleReservedSort}
                  label={t('inventory:columns.created_by')}
                  ariaSortLabelAsc={ariaAsc}
                  ariaSortLabelDesc={ariaDesc}
                />
                <SortTh
                  columnKey="last_movement_at"
                  sortState={reservedSort}
                  onSort={toggleReservedSort}
                  label={t('inventory:reserve_health.last_movement_at')}
                  ariaSortLabelAsc={ariaAsc}
                  ariaSortLabelDesc={ariaDesc}
                />
                <SortTh
                  columnKey="available_total"
                  sortState={reservedSort}
                  onSort={toggleReservedSort}
                  label={t('inventory:columns.available_total')}
                  ariaSortLabelAsc={ariaAsc}
                  ariaSortLabelDesc={ariaDesc}
                />
              </tr>
            </thead>
            <tbody>
              {sortedReserved.map((row) => {
                const avail = availableByProductId.get(row.product_id)
                return (
                  <tr
                    key={`${row.product_id}:${row.order_id}`}
                    className="border-b border-slate-100 dark:border-slate-800"
                  >
                    <td className="px-3 py-2 font-mono">{row.product_code}</td>
                    <td className="px-3 py-2">{row.product_name}</td>
                    <td className="px-3 py-2 font-mono">{row.order_number ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{Math.round(Number(row.reserved_qty))}</td>
                    <td className="px-3 py-2">{row.last_movement_by_username ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {new Date(row.last_movement_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {avail !== undefined ? Math.round(avail) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
    }

    if (sortedNegative.length === 0) {
      return (
        <EmptyState
          title={t('inventory:reserve_health.negative_empty_title')}
          description={t('inventory:reserve_health.negative_empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    return (
      <div className="overflow-auto">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <SortTh
                columnKey="code"
                sortState={negativeSort}
                onSort={toggleNegativeSort}
                label={t('inventory:columns.code')}
                ariaSortLabelAsc={ariaAsc}
                ariaSortLabelDesc={ariaDesc}
              />
              <SortTh
                columnKey="location"
                sortState={negativeSort}
                onSort={toggleNegativeSort}
                label={t('inventory:columns.location')}
                ariaSortLabelAsc={ariaAsc}
                ariaSortLabelDesc={ariaDesc}
              />
              <SortTh
                columnKey="lot"
                sortState={negativeSort}
                onSort={toggleNegativeSort}
                label={t('inventory:columns.lot')}
                ariaSortLabelAsc={ariaAsc}
                ariaSortLabelDesc={ariaDesc}
              />
              <SortTh
                columnKey="batch"
                sortState={negativeSort}
                onSort={toggleNegativeSort}
                label={t('inventory:columns.batch')}
                ariaSortLabelAsc={ariaAsc}
                ariaSortLabelDesc={ariaDesc}
              />
              <SortTh
                columnKey="on_hand"
                sortState={negativeSort}
                onSort={toggleNegativeSort}
                label={t('inventory:columns.on_hand')}
                ariaSortLabelAsc={ariaAsc}
                ariaSortLabelDesc={ariaDesc}
              />
              <SortTh
                columnKey="reserved"
                sortState={negativeSort}
                onSort={toggleNegativeSort}
                label={t('inventory:columns.reserved_total')}
                ariaSortLabelAsc={ariaAsc}
                ariaSortLabelDesc={ariaDesc}
              />
              <SortTh
                columnKey="available"
                sortState={negativeSort}
                onSort={toggleNegativeSort}
                label={t('inventory:columns.available_total')}
                ariaSortLabelAsc={ariaAsc}
                ariaSortLabelDesc={ariaDesc}
              />
            </tr>
          </thead>
          <tbody>
            {sortedNegative.map((row) => (
              <tr key={`${row.lot_id}:${row.location_id}`} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-mono">{row.sku || '—'}</td>
                <td className="px-3 py-2 font-mono">{row.location_code}</td>
                <td className="px-3 py-2 font-mono">{row.lot_id}</td>
                <td className="px-3 py-2">{row.batch}</td>
                <td className="px-3 py-2 tabular-nums">{Math.round(Number(row.on_hand))}</td>
                <td className="px-3 py-2 tabular-nums">{Math.round(Number(row.reserved))}</td>
                <td className="px-3 py-2 tabular-nums text-rose-500">{Math.round(Number(row.available))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }, [
    ariaAsc,
    ariaDesc,
    availableByProductId,
    error,
    isLoading,
    load,
    negativeSort,
    reservedSort,
    segment,
    sortedNegative,
    sortedReserved,
    t,
    toggleNegativeSort,
    toggleReservedSort,
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
          <button
            type="button"
            onClick={() => setSegment('reserved')}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              segment === 'reserved'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            <ShieldAlert size={16} />
            {t('inventory:reserve_health.segments.reserved')}
          </button>
          <button
            type="button"
            onClick={() => setSegment('negative')}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              segment === 'negative'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            <AlertTriangle size={16} />
            {t('inventory:reserve_health.segments.negative')}
          </button>

          <div className="rounded-xl border border-slate-200 px-3 py-1 text-sm dark:border-slate-800">
            {t('inventory:reserve_health.counts.reserved')}: {reservedProductCount}
          </div>
          <div className="rounded-xl border border-slate-200 px-3 py-1 text-sm dark:border-slate-800">
            {t('inventory:reserve_health.counts.negative')}: {negativeRows.length}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <input
              className="min-w-[240px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
              placeholder={t('inventory:reserve_health.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button variant="secondary" onClick={load} disabled={isLoading}>
              <RefreshCcw size={16} />
              {t('common:buttons.refresh')}
            </Button>
          </div>
        </div>

        {content}
      </Card>
    </AdminLayout>
  )
}
