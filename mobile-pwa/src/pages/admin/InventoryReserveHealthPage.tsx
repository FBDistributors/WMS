import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCcw, ShieldAlert } from 'lucide-react'
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
  type InventorySummaryRow,
  type NegativeBalanceRow,
  type WarehouseFilter,
} from '../../services/inventoryApi'

type SegmentMode = 'reserved' | 'negative'

const NEGATIVE_LIMIT = 500

export function InventoryReserveHealthPage() {
  const { t } = useTranslation(['inventory', 'common'])
  const [searchParams, setSearchParams] = useSearchParams()
  const warehouse: WarehouseFilter = (searchParams.get('warehouse') as WarehouseFilter) || 'main'
  const [segment, setSegment] = useState<SegmentMode>('reserved')
  const [search, setSearch] = useState('')
  const [reservedRows, setReservedRows] = useState<InventorySummaryRow[]>([])
  const [negativeRows, setNegativeRows] = useState<NegativeBalanceRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [summary, negative] = await Promise.all([
        getInventorySummary({ warehouse }),
        getNegativeBalanceCheck({ warehouse, limit: NEGATIVE_LIMIT }),
      ])
      setReservedRows(summary.filter((row) => Number(row.reserved_total) > 0))
      setNegativeRows(negative.rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory:load_failed'))
      setReservedRows([])
      setNegativeRows([])
    } finally {
      setIsLoading(false)
    }
  }, [t, warehouse])

  useEffect(() => {
    void load()
  }, [load])

  const normalizedSearch = search.trim().toLowerCase()

  const filteredReserved = useMemo(() => {
    if (!normalizedSearch) return reservedRows
    return reservedRows.filter((row) => {
      return (
        row.product_code.toLowerCase().includes(normalizedSearch) ||
        row.name.toLowerCase().includes(normalizedSearch)
      )
    })
  }, [normalizedSearch, reservedRows])

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
      if (filteredReserved.length === 0) {
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
          <table className="min-w-[860px] w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="px-3 py-2">{t('inventory:columns.code')}</th>
                <th className="px-3 py-2">{t('inventory:columns.product')}</th>
                <th className="px-3 py-2">{t('inventory:columns.reserved_total')}</th>
                <th className="px-3 py-2">{t('inventory:columns.available_total')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredReserved.map((row) => (
                <tr key={row.product_id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 font-mono">{row.product_code}</td>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2 tabular-nums">{Math.round(Number(row.reserved_total))}</td>
                  <td className="px-3 py-2 tabular-nums">{Math.round(Number(row.available_total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    if (filteredNegative.length === 0) {
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
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-3 py-2">{t('inventory:columns.code')}</th>
              <th className="px-3 py-2">{t('inventory:columns.location')}</th>
              <th className="px-3 py-2">{t('inventory:columns.lot')}</th>
              <th className="px-3 py-2">{t('inventory:columns.batch')}</th>
              <th className="px-3 py-2">{t('inventory:columns.on_hand')}</th>
              <th className="px-3 py-2">{t('inventory:columns.reserved_total')}</th>
              <th className="px-3 py-2">{t('inventory:columns.available_total')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredNegative.map((row) => (
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
  }, [error, filteredNegative, filteredReserved, isLoading, load, segment, t])

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
            {t('inventory:reserve_health.counts.reserved')}: {reservedRows.length}
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
