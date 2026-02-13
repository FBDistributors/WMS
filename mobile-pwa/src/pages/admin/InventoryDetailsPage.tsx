import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getLocations, type Location } from '../../services/locationsApi'
import { getInventoryDetails, type InventoryDetailRow } from '../../services/inventoryApi'

export function InventoryDetailsPage() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation(['inventory', 'common'])
  const [items, setItems] = useState<InventoryDetailRow[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState('')
  const [expiryBefore, setExpiryBefore] = useState('')
  const [showZero, setShowZero] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [details, locationsResponse] = await Promise.all([
        getInventoryDetails({
          product_id: productId,
          location_id: locationId || undefined,
          expiry_before: expiryBefore || undefined,
          show_zero: showZero,
        }),
        getLocations(true),
      ])
      setItems(details)
      setLocations(locationsResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [expiryBefore, locationId, productId, showZero, t])

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
          title={t('inventory:empty_details')}
          description={t('inventory:empty_details_desc')}
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
              <th className="px-4 py-3 text-left">{t('inventory:columns.location')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.batch')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.expiry')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.on_hand')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.reserved')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.available')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={`${row.lot_id}-${row.location_id}`} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.location_path}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.batch}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.expiry_date ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.on_hand}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.reserved}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.available}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [error, isLoading, items, load, t])

  return (
    <AdminLayout
      title={t('inventory:details_title')}
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
            {t('inventory:filters.location')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">{t('inventory:filters.all_locations')}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} · {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('inventory:filters.expiry_before')}
            <input
              type="date"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={expiryBefore}
              onChange={(event) => setExpiryBefore(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showZero}
              onChange={(event) => setShowZero(event.target.checked)}
            />
            {t('inventory:filters.show_zero')}
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={load}>{t('inventory:filters.apply')}</Button>
          <Button variant="secondary" onClick={() => navigate('/admin/inventory/movements')}>
            {t('inventory:view_movements')}
          </Button>
        </div>
      </Card>
      <Card className="space-y-4">{content}</Card>
    </AdminLayout>
  )
}
