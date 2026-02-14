import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Search, ChevronDown, ChevronRight, PackagePlus, ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  getInventorySummaryLight,
  getInventoryByProduct,
  type InventorySummaryLightRow,
  type InventoryByProductRow,
} from '../../services/inventoryApi'

const DEBOUNCE_MS = 400
const PAGE_SIZE = 50

export function InventorySummaryPage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['inventory', 'common'])
  const [data, setData] = useState<{ items: InventorySummaryLightRow[]; total: number }>({
    items: [],
    total: 0,
  })
  const [offset, setOffset] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [locationDetails, setLocationDetails] = useState<Record<string, InventoryByProductRow[]>>({})
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Debounce search (400ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await getInventorySummaryLight({
        search: debouncedSearch.trim() || undefined,
        only_available: onlyAvailable,
        limit: PAGE_SIZE,
        offset,
      })
      setData({ items: res.items, total: res.total })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [debouncedSearch, onlyAvailable, offset, t])

  // Reset offset when search/filters change
  const prevSearchRef = useRef(debouncedSearch)
  const prevOnlyRef = useRef(onlyAvailable)
  useEffect(() => {
    if (prevSearchRef.current !== debouncedSearch || prevOnlyRef.current !== onlyAvailable) {
      prevSearchRef.current = debouncedSearch
      prevOnlyRef.current = onlyAvailable
      setOffset(0)
    }
  }, [debouncedSearch, onlyAvailable])

  // Single API call on initial load and when filters change
  useEffect(() => {
    void load()
  }, [load])

  const toggleExpand = useCallback(async (productId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) {
        next.delete(productId)
        return next
      }
      next.add(productId)
      return next
    })

    if (locationDetails[productId]) return

    setLoadingDetails((prev) => new Set(prev).add(productId))
    try {
      const locs = await getInventoryByProduct(productId)
      setLocationDetails((prev) => ({ ...prev, [productId]: locs }))
    } finally {
      setLoadingDetails((prev) => {
        const next = new Set(prev)
        next.delete(productId)
        return next
      })
    }
  }, [locationDetails])

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

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return (
        <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
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
    return (
      <TableScrollArea>
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="w-8 px-1 py-3" aria-label="Expand" />
              <th className="px-4 py-3 text-left">{t('inventory:columns.product')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.brand')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.total_qty')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.available')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.location')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.location_type')}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => {
              const isExpanded = expanded.has(row.product_id)
              const locs = locationDetails[row.product_id]
              const isLoadingLocs = loadingDetails.has(row.product_id)

              return (
                <React.Fragment key={row.product_id}>
                  <tr
                    className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
                  >
                    <td className="w-8 px-1 py-2">
                      <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleExpand(row.product_id)
                          }}
                          className="p-1 text-slate-500 hover:text-slate-700"
                          aria-expanded={isExpanded}
                        >
                          {isLoadingLocs ? (
                            <span className="inline-block size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                          ) : isExpanded ? (
                            <ChevronDown size={18} />
                          ) : (
                            <ChevronRight size={18} />
                          )}
                        </button>
                    </td>
                    <td
                      className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
                      onClick={() => navigate(`/admin/inventory/${row.product_id}`)}
                    >
                      {row.product_code} · {row.product_name}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {row.brand_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {row.total_qty}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {row.available_qty}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {locs
                        ? locs.length === 0
                          ? (
                            <Link
                              to="/admin/receiving"
                              state={{ productId: row.product_id }}
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {t('inventory:enter_stock')}
                            </Link>
                            )
                          : locs.length === 1
                            ? `${locs[0].location_code} (${locs[0].available_qty} ${t('inventory:columns.qty')})`
                            : `${locs.length} ${t('inventory:columns.locations')}`
                        : isLoadingLocs
                          ? '…'
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {isExpanded && locs?.length === 1 ? locs[0].location_type ?? '—' : null}
                    </td>
                  </tr>
                  {isExpanded &&
                    locs &&
                    locs.length > 1 &&
                    locs.map((loc, idx) => (
                      <tr
                        key={`${row.product_id}-${idx}-${loc.location_code}`}
                        className="border-b border-slate-100 bg-slate-50/50 dark:bg-slate-900/20"
                      >
                        <td className="w-8 px-1 py-2" />
                        <td className="px-4 py-2 pl-8 text-slate-600 dark:text-slate-400" />
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2 font-mono text-slate-700 dark:text-slate-300">
                          {loc.location_code} ({loc.available_qty} {t('inventory:columns.qty')})
                          {loc.expiry_date ? ` · ${loc.expiry_date}` : ''}
                        </td>
                        <td className="px-4 py-2 text-slate-500">
                          {loc.location_type ?? '—'}
                        </td>
                      </tr>
                    ))}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [
    data.items,
    error,
    expanded,
    isLoading,
    load,
    locationDetails,
    loadingDetails,
    navigate,
    t,
    toggleExpand,
  ])

  return (
    <AdminLayout
      title={t('inventory:title')}
      actionSlot={
        <Button variant="secondary" onClick={load}>
          {t('common:buttons.refresh')}
        </Button>
      }
    >
      <Card className="mb-4 space-y-3">
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
        </div>
        {data.total > 0 && (
          <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
            <span>
              {pageStart}–{pageEnd} / {data.total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={goPrev}
                disabled={!hasPrev}
                className="gap-1"
              >
                <ChevronLeft size={16} />
                {t('common:buttons.back')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={goNext}
                disabled={!hasNext}
                className="gap-1"
              >
                {t('common:buttons.next')}
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Card className="space-y-4">{content}</Card>
    </AdminLayout>
  )
}
