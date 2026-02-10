import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getInventorySummary, type InventorySummaryRow } from '../../services/inventoryApi'

export function InventorySummaryPage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['inventory', 'common'])
  const [items, setItems] = useState<InventorySummaryRow[]>([])
  const [search, setSearch] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [lowStock, setLowStock] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const threshold = lowStock.trim() ? Number(lowStock) : undefined
      const data = await getInventorySummary({
        search: search.trim() || undefined,
        only_available: onlyAvailable,
        low_stock_threshold: Number.isFinite(threshold) ? threshold : undefined,
      })
      setItems(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [lowStock, onlyAvailable, search, t])

  useEffect(() => {
    void load()
  }, [load])

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return (
        <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
      )
    }
    if (items.length === 0) {
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
              <th className="px-4 py-3 text-left">{t('inventory:columns.product')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.on_hand')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.reserved')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.available')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.lots')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.locations')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.product_id}
                className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
                onClick={() => navigate(`/admin/inventory/${row.product_id}`)}
              >
                <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                  {row.product_code} · {row.name}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.on_hand_total}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.reserved_total}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.available_total}</td>
                <td className="px-4 py-3 text-slate-500">{row.lots_count}</td>
                <td className="px-4 py-3 text-slate-500">{row.locations_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }, [error, isLoading, items, load, navigate, t])

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
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('inventory:filters.low_stock')}
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={lowStock}
              onChange={(event) => setLowStock(event.target.value)}
            />
          </label>
          <Button onClick={load}>{t('inventory:filters.apply')}</Button>
        </div>
      </Card>
      <Card className="space-y-4">{content}</Card>
    </AdminLayout>
  )
}
