import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  getInventorySummaryByLocation,
  type InventorySummaryWithLocationRow,
} from '../../services/inventoryApi'

type ProductGroup = {
  product_id: string
  product_code: string
  name: string
  brand: string | null
  total_qty: number
  available_qty: number
  locations: InventorySummaryWithLocationRow[]
}

function groupByProduct(rows: InventorySummaryWithLocationRow[]): ProductGroup[] {
  const byProduct = new Map<string, ProductGroup>()
  for (const row of rows) {
    const key = row.product_id
    const existing = byProduct.get(key)
    if (existing) {
      existing.total_qty += row.on_hand
      existing.available_qty += row.available
      existing.locations.push(row)
    } else {
      byProduct.set(key, {
        product_id: row.product_id,
        product_code: row.product_code,
        name: row.name,
        brand: row.brand ?? null,
        total_qty: row.on_hand,
        available_qty: row.available,
        locations: [row],
      })
    }
  }
  return Array.from(byProduct.values())
}

export function InventorySummaryPage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['inventory', 'common'])
  const [rows, setRows] = useState<InventorySummaryWithLocationRow[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getInventorySummaryByLocation({
        search: search.trim() || undefined,
        only_available: onlyAvailable,
      })
      setRows(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [onlyAvailable, search, t])

  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => groupByProduct(rows), [rows])

  const toggleExpand = useCallback((productId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }, [])

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return (
        <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
      )
    }
    if (groups.length === 0) {
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
      <div className="overflow-x-auto">
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
            {groups.map((group) => {
              const isExpanded = expanded.has(group.product_id)
              const hasMultiple = group.locations.length > 1
              return (
                <React.Fragment key={group.product_id}>
                  <tr
                    className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
                  >
                    <td className="w-8 px-1 py-2">
                      {hasMultiple ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleExpand(group.product_id)
                          }}
                          className="p-1 text-slate-500 hover:text-slate-700"
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? (
                            <ChevronDown size={18} />
                          ) : (
                            <ChevronRight size={18} />
                          )}
                        </button>
                      ) : null}
                    </td>
                    <td
                      className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
                      onClick={() => navigate(`/admin/inventory/${group.product_id}`)}
                    >
                      {group.product_code} · {group.name}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {group.brand ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {group.total_qty}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {group.available_qty}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {hasMultiple && !isExpanded
                        ? `${group.locations.length} ${t('inventory:columns.locations')}`
                        : group.locations.length === 1
                          ? group.locations[0].location_code
                          : null}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {group.locations.length === 1
                        ? group.locations[0].location_type ?? '—'
                        : null}
                    </td>
                  </tr>
                  {isExpanded &&
                    group.locations.map((loc) => (
                      <tr
                        key={`${group.product_id}-${loc.location_id}`}
                        className="border-b border-slate-100 bg-slate-50/50 dark:bg-slate-900/20"
                      >
                        <td className="w-8 px-1 py-2" />
                        <td className="px-4 py-2 pl-8 text-slate-600 dark:text-slate-400" />
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2 font-mono text-slate-700 dark:text-slate-300">
                          {loc.location_code} ({loc.available} {t('inventory:columns.qty')})
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
      </div>
    )
  }, [error, expanded, groups, isLoading, load, navigate, t, toggleExpand])

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
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={onlyAvailable}
              onChange={(event) => setOnlyAvailable(event.target.checked)}
            />
            {t('inventory:filters.only_available')}
          </label>
          <Button onClick={load}>{t('inventory:filters.apply')}</Button>
        </div>
      </Card>
      <Card className="space-y-4">{content}</Card>
    </AdminLayout>
  )
}
