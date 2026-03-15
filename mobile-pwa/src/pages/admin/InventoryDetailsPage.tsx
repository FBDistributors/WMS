import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardList, ShoppingCart, Truck, Warehouse } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { DateInput } from '../../components/DateInput'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { getLocations, type Location } from '../../services/locationsApi'
import { getInventoryDetails, type InventoryDetailRow } from '../../services/inventoryApi'
import { getProductHistory, type ProductHistoryResponse } from '../../services/productsApi'
import { formatExpiryDate } from '../../utils/expiry'

type TabId = 'receiving' | 'picks' | 'adjustments' | 'stock'

function formatDate(iso: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
  } catch {
    return iso
  }
}

export function InventoryDetailsPage() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation(['inventory', 'common', 'products'])
  const [items, setItems] = useState<InventoryDetailRow[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState('')
  const [expiryBefore, setExpiryBefore] = useState('')
  const [showZero, setShowZero] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('stock')
  const [history, setHistory] = useState<ProductHistoryResponse | null>(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    if (!productId) {
      setHistoryLoading(false)
      return
    }
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const data = await getProductHistory(productId)
      setHistory(data)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : t('products:history_load_failed'))
      setHistory(null)
    } finally {
      setHistoryLoading(false)
    }
  }, [productId, t])

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

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const tabs: { id: TabId; labelKey: string; icon: React.ReactNode }[] = [
    { id: 'receiving', labelKey: 'products:history.receiving_history', icon: <Truck size={16} /> },
    { id: 'picks', labelKey: 'products:history.pick_history', icon: <ShoppingCart size={16} /> },
    { id: 'adjustments', labelKey: 'products:history.adjustment_history', icon: <ClipboardList size={16} /> },
    { id: 'stock', labelKey: 'products:history.tab_stock', icon: <Warehouse size={16} /> },
  ]

  const stockContent = useMemo(() => {
    if (isLoading) {
      return (
        <div className="relative flex-1 min-h-[200px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
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
                  {formatExpiryDate(row.expiry_date)}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {Math.round(Number(row.on_hand))}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {Math.round(Number(row.reserved))}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {Math.round(Number(row.available))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [error, isLoading, items, load, t])

  return (
    <AdminLayout title={t('inventory:details_title')}>
      <Card className="mb-4 space-y-3">
        <div className="flex justify-start">
          <Button variant="ghost" onClick={() => navigate('/admin/inventory')}>
            <ArrowLeft size={16} />
            {t('inventory:back_to_summary')}
          </Button>
        </div>
      </Card>
      <Card className="min-w-0 overflow-hidden p-0">
        <div className="border-b border-slate-200 dark:border-slate-700">
          <nav className="flex gap-1 overflow-x-auto px-4 pt-2" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                }`}
              >
                {tab.icon}
                {t(tab.labelKey)}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4">
          {historyError && activeTab !== 'stock' && (
            <p className="mb-4 text-sm text-amber-600 dark:text-amber-400">{historyError}</p>
          )}

          {activeTab === 'receiving' && (
            <section>
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('products:history.receiving_history')}
              </h3>
              {historyLoading ? (
                <div className="h-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
              ) : !history || history.receiving.length === 0 ? (
                <p className="text-sm text-slate-500">{t('products:history.no_receiving')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.date')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.received_by')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.doc_no')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.qty')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.batch')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.location')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.receiving.map((row, idx) => (
                        <tr key={idx} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {formatDate(row.date)}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {row.received_by ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {row.doc_no}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                            {row.qty}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {row.batch}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {row.location_name ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === 'picks' && (
            <section>
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('products:history.pick_history')}
              </h3>
              {historyLoading ? (
                <div className="h-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
              ) : !history || history.picks.length === 0 ? (
                <p className="text-sm text-slate-500">{t('products:history.no_picks')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.date')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.picked_by')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.order_number')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.qty')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.picks.map((row, idx) => (
                        <tr key={idx} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {formatDate(row.date)}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {row.picked_by ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {row.order_number ?? row.document_doc_no ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                            {row.qty}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === 'adjustments' && (
            <section>
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('products:history.adjustment_history')}
              </h3>
              {historyLoading ? (
                <div className="h-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
              ) : !history || !history.adjustments?.length ? (
                <p className="text-sm text-slate-500">{t('products:history.no_adjustments')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.date')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.adjusted_by')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.location_code')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                          {t('products:history.qty_change')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.adjustments.map((row, idx) => (
                        <tr key={idx} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {formatDate(row.date)}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {row.adjusted_by ?? '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">
                            {row.location_code ?? '—'}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-medium ${
                              row.qty_change < 0
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {row.qty_change > 0 ? '+' : ''}{row.qty_change}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === 'stock' && (
            <section className="space-y-4">
              <Card className="space-y-3 p-4">
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
                          {location.code === location.name ? location.code : `${location.code} · ${location.name}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-slate-600 dark:text-slate-300">
                    {t('inventory:filters.expiry_before')}
                    <DateInput
                      value={expiryBefore}
                      onChange={setExpiryBefore}
                      className="mt-1 w-full"
                      aria-label={t('inventory:filters.expiry_before')}
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
              {stockContent}
            </section>
          )}
        </div>
      </Card>
    </AdminLayout>
  )
}
