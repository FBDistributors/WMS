import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { InventoryHeaderTabs } from '../../admin/components/inventory/InventoryHeaderTabs'
import { DateInput } from '../../components/DateInput'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import {
  getReserveHistory,
  type ReserveHistoryRow,
  type WarehouseFilter,
} from '../../services/inventoryApi'

const PAGE_SIZE = 50

type MovementFilter = '' | 'allocate' | 'unallocate'

export function InventoryReserveHistoryPage() {
  const { t } = useTranslation(['inventory', 'common'])
  const [searchParams, setSearchParams] = useSearchParams()
  const warehouse: WarehouseFilter = (searchParams.get('warehouse') as WarehouseFilter) || 'main'
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [movementType, setMovementType] = useState<MovementFilter>('')
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<ReserveHistoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const { showError } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setHasLoadError(false)
    try {
      const response = await getReserveHistory({
        search: search.trim() || undefined,
        movement_type: movementType || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        warehouse,
        limit: PAGE_SIZE,
        offset,
      })
      setRows(response.items)
      setTotal(response.total)
    } catch (err) {
      showError(err instanceof Error ? err.message : t('inventory:load_failed'))
      setHasLoadError(true)
      setRows([])
      setTotal(0)
    } finally {
      setIsLoading(false)
    }
  }, [dateFrom, dateTo, movementType, offset, search, showError, t, warehouse])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setOffset(0)
  }, [warehouse])

  const handleApply = () => {
    if (offset === 0) {
      void load()
      return
    }
    setOffset(0)
  }

  const pageLabel = useMemo(() => {
    if (total === 0) return '0 / 0'
    const from = offset + 1
    const to = Math.min(offset + PAGE_SIZE, total)
    return `${from}-${to} / ${total}`
  }, [offset, total])

  const hasPrev = offset > 0
  const hasNext = offset + PAGE_SIZE < total

  const content = () => {
    if (isLoading) {
      return (
        <div className="relative min-h-[300px]">
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
    if (rows.length === 0) {
      return (
        <EmptyState
          title={t('inventory:reserve_history.empty_title')}
          description={t('inventory:reserve_history.empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    return (
      <TableScrollArea>
        <table className="w-full min-w-[980px] text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                {t('inventory:columns.movement_type')}
              </th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                {t('inventory:columns.qty')}
              </th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                {t('inventory:columns.product')}
              </th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                {t('inventory:columns.order')}
              </th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                {t('inventory:columns.document')}
              </th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                {t('inventory:columns.location')}
              </th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                {t('inventory:columns.created_by')}
              </th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                {t('inventory:columns.created_at')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-3 py-3 text-slate-700 dark:text-slate-200 sm:px-4">
                  {t(`inventory:movement_types.${row.movement_type}`, row.movement_type)}
                </td>
                <td className="px-3 py-3 font-medium tabular-nums text-slate-700 dark:text-slate-200 sm:px-4">
                  {Math.round(Number(row.qty_change))}
                </td>
                <td className="max-w-[260px] px-3 py-3 text-slate-700 dark:text-slate-200 sm:px-4">
                  <span className="block truncate" title={row.product_name ?? undefined}>
                    {[row.product_code, row.product_name].filter(Boolean).join(' — ') || row.product_id}
                  </span>
                </td>
                <td className="px-3 py-3 text-slate-700 dark:text-slate-200 sm:px-4">
                  {row.order_number ?? '—'}
                </td>
                <td className="px-3 py-3 text-slate-700 dark:text-slate-200 sm:px-4">
                  {row.doc_no ?? '—'}
                </td>
                <td className="px-3 py-3 text-slate-700 dark:text-slate-200 sm:px-4">
                  {row.location_code ?? row.location_id}
                </td>
                <td className="px-3 py-3 text-slate-700 dark:text-slate-200 sm:px-4">
                  {row.created_by_username ?? '—'}
                </td>
                <td className="px-3 py-3 text-slate-600 dark:text-slate-300 sm:px-4">
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
    <AdminLayout titleSlot={<InventoryHeaderTabs />}>
      <Card className="mb-4 space-y-3">
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
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('inventory:reserve_history.search_label')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('inventory:reserve_history.search_placeholder')}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('inventory:filters.movement_type')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={movementType}
              onChange={(event) => setMovementType(event.target.value as MovementFilter)}
            >
              <option value="">{t('inventory:reserve_history.all_reserve_events')}</option>
              <option value="allocate">{t('inventory:movement_types.allocate')}</option>
              <option value="unallocate">{t('inventory:movement_types.unallocate')}</option>
            </select>
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('inventory:filters.date_from')}
            <DateInput
              value={dateFrom}
              onChange={setDateFrom}
              className="mt-1 w-full"
              aria-label={t('inventory:filters.date_from')}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('inventory:filters.date_to')}
            <DateInput
              value={dateTo}
              onChange={setDateTo}
              className="mt-1 w-full"
              aria-label={t('inventory:filters.date_to')}
            />
          </label>
        </div>
        <Button onClick={handleApply}>{t('inventory:filters.apply')}</Button>
      </Card>
      <Card className="space-y-4">{content()}</Card>
      <div className="mt-4 flex items-center justify-end gap-2 text-sm text-slate-600 dark:text-slate-300">
        <span>{pageLabel}</span>
        <Button
          variant="secondary"
          disabled={!hasPrev}
          onClick={() => setOffset((prev) => Math.max(prev - PAGE_SIZE, 0))}
        >
          {t('common:buttons.back')}
        </Button>
        <Button variant="secondary" disabled={!hasNext} onClick={() => setOffset((prev) => prev + PAGE_SIZE)}>
          {t('common:buttons.next')}
        </Button>
      </div>
    </AdminLayout>
  )
}
