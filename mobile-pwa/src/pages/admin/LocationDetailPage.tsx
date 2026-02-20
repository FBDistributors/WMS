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
  const [filterQuery, setFilterQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const filteredItems = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    if (!q) return items
    return items.filter((row) => {
      const code = (row.product_code ?? '').toLowerCase()
      const name = (row.product_name ?? '').toLowerCase()
      const barcode = (row.barcode ?? '').toLowerCase()
      const brand = (row.brand ?? '').toLowerCase()
      const batch = (row.batch ?? '').toLowerCase()
      const expiry = (row.expiry_date ?? '').toString().toLowerCase()
      return (
        code.includes(q) ||
        name.includes(q) ||
        barcode.includes(q) ||
        brand.includes(q) ||
        batch.includes(q) ||
        expiry.includes(q)
      )
    })
  }, [items, filterQuery])

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
      <>
        <label className="block text-sm text-slate-600 dark:text-slate-300">
          <input
            type="text"
            className="mt-1 w-full max-w-md rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={t('locations:detail_filter_placeholder')}
          />
        </label>
        <div className="max-h-[calc(100vh-320px)] min-h-0 overflow-auto">
          <TableScrollArea inline>
            <table className="w-max min-w-[600px] text-sm">
              <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-3 py-3 text-center">{t('locations:detail_col_code')}</th>
                  <th className="min-w-[180px] max-w-[280px] px-3 py-3 text-center">{t('locations:detail_col_product_name')}</th>
                  <th className="px-3 py-3 text-center">{t('locations:detail_col_barcode')}</th>
                  <th className="px-3 py-3 text-center">{t('locations:detail_col_brand')}</th>
                  <th className="px-3 py-3 text-center">{t('locations:detail_col_batch')}</th>
                  <th className="px-3 py-3 text-center">{t('locations:detail_col_expiry')}</th>
                  <th className="px-3 py-3 text-center">{t('locations:detail_col_qty')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                      {filterQuery.trim() ? t('locations:filter_no_results') : t('locations:detail_empty')}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((row) => (
                    <tr
                      key={`${row.lot_id}`}
                      className="border-b border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-3 py-3 text-center font-medium text-slate-800 dark:text-slate-200">
                        {row.product_code}
                      </td>
                      <td className="min-w-[180px] max-w-[280px] px-3 py-3 text-center text-slate-700 dark:text-slate-200">
                        <span className="line-clamp-2 block">{row.product_name}</span>
                      </td>
                      <td className="px-3 py-3 text-center font-mono text-xs text-slate-700 dark:text-slate-200">
                        {row.barcode ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-center text-slate-700 dark:text-slate-200">
                        {row.brand ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-center text-slate-700 dark:text-slate-200">{row.batch}</td>
                      <td className="px-3 py-3 text-center text-slate-700 dark:text-slate-200">
                        {row.expiry_date ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-center font-medium text-slate-800 dark:text-slate-200">
                        {Math.round(Number(row.on_hand))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableScrollArea>
        </div>
      </>
    )
  }, [error, isLoading, items, filteredItems, filterQuery, load, navigate, t])

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
