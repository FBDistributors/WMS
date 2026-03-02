import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
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
        <label className="block w-full text-sm text-slate-600 dark:text-slate-300">
          <div className="relative mt-1 max-w-md">
            <input
              type="text"
              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-3 pr-9 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t('locations:detail_filter_placeholder')}
            />
            {filterQuery && (
              <button
                type="button"
                onClick={() => setFilterQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                aria-label={t('common:buttons.clear')}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </label>
        <div className="w-full max-h-[calc(100vh-320px)] min-h-0 overflow-auto">
          <TableScrollArea inline className="w-full">
            <table className="w-full min-w-[600px] text-sm table-fixed">
              <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="w-24 px-3 py-3 text-center">{t('locations:detail_col_code')}</th>
                  <th className="min-w-0 px-3 py-3 text-center" style={{ width: '30%' }}>{t('locations:detail_col_product_name')}</th>
                  <th className="w-28 px-3 py-3 text-center">{t('locations:detail_col_barcode')}</th>
                  <th className="w-28 px-3 py-3 text-center">{t('locations:detail_col_brand')}</th>
                  <th className="w-20 px-3 py-3 text-center">{t('locations:detail_col_batch')}</th>
                  <th className="w-28 px-3 py-3 text-center">{t('locations:detail_col_expiry')}</th>
                  <th className="w-20 px-3 py-3 text-center">{t('locations:detail_col_qty')}</th>
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
                      <td className="min-w-0 px-3 py-3 text-center text-slate-700 dark:text-slate-200" style={{ width: '30%' }}>
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
    <AdminLayout title={title}>
      <Card className="w-full max-w-full space-y-4">
        <div>
          <Button
            variant="ghost"
            className="p-2"
            aria-label={t('common:buttons.back')}
            onClick={() => navigate('/admin/locations')}
          >
            <ArrowLeft size={20} />
          </Button>
        </div>
        {content}
      </Card>
    </AdminLayout>
  )
}
