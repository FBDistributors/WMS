import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Info, Package, ShoppingCart, Truck, Warehouse } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  getProduct,
  getProductHistory,
  type Product,
  type ProductHistoryResponse,
} from '../../services/productsApi'
import {
  getInventorySummaryByLocation,
  type InventorySummaryWithLocationRow,
} from '../../services/inventoryApi'

function formatDate(iso: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
  } catch {
    return iso
  }
}

type TabId = 'basic' | 'receiving' | 'picks' | 'stock'

export function ProductDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation(['products', 'common'])
  const [product, setProduct] = useState<Product | null>(null)
  const [history, setHistory] = useState<ProductHistoryResponse | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('basic')
  const [isLoading, setIsLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [stockByLocation, setStockByLocation] = useState<InventorySummaryWithLocationRow[] | null>(null)
  const [stockByLocationLoading, setStockByLocationLoading] = useState(false)

  const loadStockByLocation = useCallback(async (productId: string) => {
    setStockByLocationLoading(true)
    setStockByLocation(null)
    try {
      const rows = await getInventorySummaryByLocation({ product_ids: [productId] })
      setStockByLocation(rows)
    } catch {
      setStockByLocation([])
    } finally {
      setStockByLocationLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    if (!id) {
      setError(t('products:not_found'))
      setIsLoading(false)
      setHistoryLoading(false)
      return
    }
    setIsLoading(true)
    setHistoryLoading(true)
    setError(null)
    setHistoryError(null)
    try {
      const [productData, historyData] = await Promise.all([
        getProduct(id),
        getProductHistory(id).catch((err) => {
          setHistoryError(err instanceof Error ? err.message : t('products:history_load_failed'))
          return null
        }),
      ])
      setProduct(productData)
      if (historyData) setHistory(historyData)
      else setHistory(null)
    } catch (err) {
      setError(t('products:load_failed'))
    } finally {
      setIsLoading(false)
      setHistoryLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (activeTab === 'stock' && product?.id) {
      void loadStockByLocation(product.id)
    }
  }, [activeTab, product?.id, loadStockByLocation])

  if (isLoading) {
    return (
      <AdminLayout title={t('products:details_title')}>
        <div className="h-32 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
      </AdminLayout>
    )
  }

  if (!product || error) {
    return (
      <AdminLayout title={t('products:details_title')}>
        <EmptyState
          title={error ?? t('products:not_found')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      </AdminLayout>
    )
  }

  const onHand = history?.on_hand_total ?? product?.on_hand_total
  const reserved = history?.reserved_total ?? product?.reserved_total
  const available = history?.available_total ?? product?.available_total

  const tabs: { id: TabId; labelKey: string; icon: React.ReactNode }[] = [
    { id: 'basic', labelKey: 'products:history.tab_basic', icon: <Info size={16} /> },
    { id: 'receiving', labelKey: 'products:history.receiving_history', icon: <Truck size={16} /> },
    { id: 'picks', labelKey: 'products:history.pick_history', icon: <ShoppingCart size={16} /> },
    { id: 'stock', labelKey: 'products:history.tab_stock', icon: <Warehouse size={16} /> },
  ]

  return (
    <AdminLayout
      title={t('products:details_title')}
      actionSlot={
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          {t('products:details_close')}
        </Button>
      }
    >
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left panel: image + summary */}
        <Card className="shrink-0 lg:w-[320px]">
          <div className="flex flex-col items-center gap-4 p-4">
            <div className="flex h-48 w-48 items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
              {product.photo_url ? (
                <img
                  src={product.photo_url}
                  alt={product.name}
                  className="h-full w-full object-contain"
                />
              ) : (
                <Package className="h-20 w-20 text-slate-400" />
              )}
            </div>
            <div className="w-full text-center">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 line-clamp-3">
                {product.name}
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {product.sku} {product.id && `(${product.id.slice(0, 8)}…)`}
              </p>
            </div>
            <div className="w-full">
              <span
                className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
                  product.is_active
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                }`}
              >
                {product.is_active ? t('common:status.active') : t('common:status.inactive')}
              </span>
            </div>
          </div>
        </Card>

        {/* Right panel: tabs + content */}
        <Card className="min-w-0 flex-1 overflow-hidden p-0">
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
            {historyError && (
              <p className="mb-4 text-sm text-amber-600 dark:text-amber-400">{historyError}</p>
            )}

            {activeTab === 'basic' && (
              <section>
                <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('products:history.tab_basic')}
                </h3>
                <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-slate-500 dark:text-slate-400">
                      {t('products:fields.name')}
                    </dt>
                    <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{product.name}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-slate-500 dark:text-slate-400">
                      {t('products:fields.sku')}
                    </dt>
                    <dd className="mt-0.5 font-mono text-slate-900 dark:text-slate-100">
                      {product.sku}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-slate-500 dark:text-slate-400">
                      {t('products:fields.barcode')}
                    </dt>
                    <dd className="mt-0.5 font-mono text-slate-900 dark:text-slate-100">
                      {product.barcode ?? product.barcodes?.join(', ') ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-slate-500 dark:text-slate-400">
                      {t('products:fields.brand')}
                    </dt>
                    <dd className="mt-0.5 text-slate-900 dark:text-slate-100">
                      {product.brand_display_name ?? product.brand_name ?? product.brand ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-slate-500 dark:text-slate-400">
                      {t('products:fields.category')}
                    </dt>
                    <dd className="mt-0.5 text-slate-900 dark:text-slate-100">
                      {product.category ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-slate-500 dark:text-slate-400">
                      {t('products:fields.status')}
                    </dt>
                    <dd className="mt-0.5 text-slate-900 dark:text-slate-100">
                      {product.is_active ? t('common:status.active') : t('common:status.inactive')}
                    </dd>
                  </div>
                </dl>
              </section>
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
                          <tr
                            key={idx}
                            className="border-b border-slate-100 dark:border-slate-800"
                          >
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
                          <tr
                            key={idx}
                            className="border-b border-slate-100 dark:border-slate-800"
                          >
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

            {activeTab === 'stock' && (
              <section>
                <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('products:history.tab_stock')}
                </h3>
                <h4 className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                  {t('products:history.total_stock')}
                </h4>
                <dl className="mb-6 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      {t('products:history.on_hand')}
                    </dt>
                    <dd className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                      {onHand != null ? Math.round(Number(onHand)) : '—'}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      {t('products:history.reserved')}
                    </dt>
                    <dd className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                      {reserved ?? '—'}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      {t('products:history.available')}
                    </dt>
                    <dd className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                      {available != null ? Math.round(Number(available)) : '—'}
                    </dd>
                  </div>
                </dl>
                <h4 className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                  {t('products:history.by_location')}
                </h4>
                {stockByLocationLoading ? (
                  <div className="h-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
                ) : !stockByLocation || stockByLocation.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {t('products:history.no_stock_by_location')}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                            {t('products:history.location_code')}
                          </th>
                          <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                            {t('products:history.on_hand')}
                          </th>
                          <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                            {t('products:history.reserved')}
                          </th>
                          <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                            {t('products:history.available')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockByLocation.map((row, idx) => (
                          <tr
                            key={row.location_id ?? idx}
                            className="border-b border-slate-100 dark:border-slate-800"
                          >
                            <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">
                              {row.location_code}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                              {Math.round(Number(row.on_hand))}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                              {Math.round(Number(row.reserved))}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                              {Math.round(Number(row.available))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </div>
        </Card>
      </div>
    </AdminLayout>
  )
}
