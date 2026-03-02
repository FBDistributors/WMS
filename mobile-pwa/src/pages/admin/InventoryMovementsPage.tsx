import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { DateInput } from '../../components/DateInput'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getInventoryMovements, type InventoryMovement } from '../../services/inventoryApi'

const PAGE_SIZE = 50

const MOVEMENT_TYPES = [
  'opening_balance',
  'receipt',
  'putaway',
  'allocate',
  'unallocate',
  'pick',
  'ship',
  'adjust',
  'transfer_in',
  'transfer_out',
]

export function InventoryMovementsPage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['inventory', 'common'])
  const [items, setItems] = useState<InventoryMovement[]>([])
  const [movementType, setMovementType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [offset, setOffset] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getInventoryMovements({
        movement_type: movementType || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setItems(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [dateFrom, dateTo, movementType, offset, t])

  const handleApply = () => {
    if (offset === 0) {
      void load()
      return
    }
    setOffset(0)
  }

  useEffect(() => {
    void load()
  }, [load])

  const content = () => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('inventory:movements_empty')}
          description={t('inventory:movements_empty_desc')}
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
              <th className="px-4 py-3 text-left">{t('inventory:columns.movement_type')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.qty')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.product')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.lot')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.location')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.created_at')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {t(`inventory:movement_types.${row.movement_type}`, row.movement_type)}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {Math.round(Number(row.qty_change))}
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
                <td className="px-4 py-3 text-slate-500">{row.lot_id}</td>
                <td className="px-4 py-3 text-slate-500">{row.location_id}</td>
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
    <AdminLayout
      title={t('inventory:movements_title')}
      actionSlot={
        <Button variant="ghost" onClick={() => navigate('/admin/inventory')}>
          <ArrowLeft size={16} />
          {t('inventory:back_to_summary')}
        </Button>
      }
    >
      <Card className="mb-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('inventory:filters.movement_type')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={movementType}
              onChange={(event) => setMovementType(event.target.value)}
            >
              <option value="">{t('inventory:filters.all_types')}</option>
              {MOVEMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`inventory:movement_types.${type}`, type)}
                </option>
              ))}
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
        <Button
          variant="secondary"
          disabled={offset === 0}
          onClick={() => setOffset((prev) => Math.max(prev - PAGE_SIZE, 0))}
        >
          {t('common:buttons.back')}
        </Button>
        <Button variant="secondary" onClick={() => setOffset((prev) => prev + PAGE_SIZE)}>
          {t('common:buttons.next')}
        </Button>
      </div>
    </AdminLayout>
  )
}
