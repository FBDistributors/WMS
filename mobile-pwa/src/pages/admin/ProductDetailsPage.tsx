import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardList, Info, Package, ShoppingCart, Truck, Warehouse } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import {
  getProduct,
  getProductHistory,
  type Product,
  type ProductHistoryResponse,
} from '../../services/productsApi'
import { useAppToast } from '../../feedback/useAppToast'
import {
  getInventorySummaryByLocation,
  type InventorySummaryWithLocationRow,
} from '../../services/inventoryApi'
import { HistoryTable } from '../../admin/components/history/HistoryTable'
import { useProductHistoryColumns } from '../../admin/components/history/productHistoryColumns'

type TabId = 'basic' | 'receiving' | 'picks' | 'adjustments' | 'stock'

export function ProductDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation(['products', 'common'])
  const historyColumns = useProductHistoryColumns()
  const [product, setProduct] = useState<Product | null>(null)
  const [history, setHistory] = useState<ProductHistoryResponse | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('basic')
  const [isLoading, setIsLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const { showError, showWarning } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)
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
      setHasLoadError(true)
      setIsLoading(false)
      setHistoryLoading(false)
      return
    }
    setIsLoading(true)
    setHistoryLoading(true)
    setHasLoadError(false)
    try {
      const [productData, historyData] = await Promise.all([
        getProduct(id),
        getProductHistory(id).catch((err) => {
          showWarning(err instanceof Error ? err.message : t('products:history_load_failed'))
          return null
        }),
      ])
      setProduct(productData)
      if (historyData) setHistory(historyData)
      else setHistory(null)
    } catch {
      showError(t('products:load_failed'))
      setHasLoadError(true)
    } finally {
      setIsLoading(false)
      setHistoryLoading(false)
    }
  }, [id, showError, showWarning, t])

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
        <div className="relative min-h-[200px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      </AdminLayout>
    )
  }

  if (!product || hasLoadError) {
    return (
      <AdminLayout title={t('products:details_title')}>
        <EmptyState
          title={hasLoadError ? t('products:load_failed') : t('products:not_found')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      </AdminLayout>
    )
  }

  const available = history?.available_total ?? product?.available_total

  const tabs: { id: TabId; labelKey: string; icon: React.ReactNode }[] = [
    { id: 'basic', labelKey: 'products:history.tab_basic', icon: <Info size={16} /> },
    { id: 'receiving', labelKey: 'products:history.receiving_history', icon: <Truck size={16} /> },
    { id: 'picks', labelKey: 'products:history.pick_history', icon: <ShoppingCart size={16} /> },
    { id: 'adjustments', labelKey: 'products:history.adjustment_history', icon: <ClipboardList size={16} /> },
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
      <div className="flex flex-col gap-4">
        {/* Mahsulot tanigich: jadval tablarida kenglik egallamasin deb ingichka.
            Katta rasm va to'liq maydonlar "Asosiy ma'lumot" tabida. */}
        <Card className="p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
              {product.photo_url ? (
                <img
                  src={product.photo_url}
                  alt={product.name}
                  className="h-full w-full object-contain"
                />
              ) : (
                <Package className="h-6 w-6 text-slate-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2
                className="truncate text-base font-semibold text-slate-900 dark:text-slate-100"
                title={product.name}
              >
                {product.name}
              </h2>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {product.sku} {product.id && `(${product.id.slice(0, 8)}…)`}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                product.is_active
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
              }`}
            >
              {product.is_active ? t('common:status.active') : t('common:status.inactive')}
            </span>
          </div>
        </Card>

        {/* Tablar to'liq kenglikda */}
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

            {activeTab === 'basic' && (
              <section>
                <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('products:history.tab_basic')}
                </h3>
                {product.photo_url ? (
                  <div className="mb-6 flex h-48 w-48 items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
                    <img
                      src={product.photo_url}
                      alt={product.name}
                      className="h-full w-full object-contain"
                    />
                  </div>
                ) : null}
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
                <HistoryTable
                  columns={historyColumns.receiving}
                  rows={history?.receiving}
                  loading={historyLoading}
                  emptyText={t('products:history.no_receiving')}
                  minWidth="min-w-[57rem]"
                />
              </section>
            )}

            {activeTab === 'picks' && (
              <section>
                <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('products:history.pick_history')}
                </h3>
                <HistoryTable
                  columns={historyColumns.picks}
                  rows={history?.picks}
                  loading={historyLoading}
                  emptyText={t('products:history.no_picks')}
                  minWidth="min-w-[60rem]"
                />
              </section>
            )}

            {activeTab === 'adjustments' && (
              <section>
                <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('products:history.adjustment_history')}
                </h3>
                <HistoryTable
                  columns={historyColumns.adjustments}
                  rows={history?.adjustments}
                  loading={historyLoading}
                  emptyText={t('products:history.no_adjustments')}
                  minWidth="min-w-[43rem]"
                />
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
                <dl className="mb-6 grid gap-4 sm:grid-cols-1">
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
                <HistoryTable
                  columns={historyColumns.stock}
                  rows={stockByLocation}
                  loading={stockByLocationLoading}
                  emptyText={t('products:history.no_stock_by_location')}
                  getRowKey={(row, index) => row.location_id ?? String(index)}
                  minWidth="min-w-[20rem]"
                />
              </section>
            )}
          </div>
        </Card>
      </div>
    </AdminLayout>
  )
}
