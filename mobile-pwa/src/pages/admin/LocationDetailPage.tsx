import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getLocation, type Location } from '../../services/locationsApi'
import { getInventoryByLocation, type InventoryByLocationRow } from '../../services/inventoryApi'

export function LocationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation(['locations', 'common'])
  const [location, setLocation] = useState<Location | null>(null)
  const [items, setItems] = useState<InventoryByLocationRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    setError(null)
    try {
      const [loc, inventory] = await Promise.all([
        getLocation(id),
        getInventoryByLocation(id),
      ])
      setLocation(loc)
      setItems(inventory)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('locations:load_failed'))
      setLocation(null)
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

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
          title={t('locations:detail_empty')}
          actionLabel={t('common:buttons.back')}
          onAction={() => navigate('/admin/locations')}
        />
      )
    }
    return (
      <TableScrollArea>
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-4 py-3 text-left">{t('locations:detail_col_code')}</th>
              <th className="px-4 py-3 text-left">{t('locations:detail_col_product_name')}</th>
              <th className="px-4 py-3 text-left">{t('locations:detail_col_barcode')}</th>
              <th className="px-4 py-3 text-left">{t('locations:detail_col_brand')}</th>
              <th className="px-4 py-3 text-left">{t('locations:detail_col_batch')}</th>
              <th className="px-4 py-3 text-left">{t('locations:detail_col_expiry')}</th>
              <th className="px-4 py-3 text-right">{t('locations:detail_col_qty')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={`${row.lot_id}`}
                className="border-b border-slate-100 dark:border-slate-800"
              >
                <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                  {row.product_code}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.product_name}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200 font-mono text-xs">
                  {row.barcode ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.brand ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.batch}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.expiry_date ?? '—'}
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-800 dark:text-slate-200">
                  {Math.round(Number(row.on_hand))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [error, isLoading, items, load, navigate, t])

  const title = location ? location.code : (id ?? '')

  return (
    <AdminLayout
      title={title}
      actionSlot={
        <Button variant="ghost" onClick={() => navigate('/admin/locations')}>
          <ArrowLeft size={16} />
          {t('locations:title')}
        </Button>
      }
    >
      <Card className="space-y-4">{content}</Card>
    </AdminLayout>
  )
}
