import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ClipboardList, Package, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { resolveBarcode } from '../../services/scannerApi'
import { getInventoryByBarcode } from '../../services/pickerInventoryApi'
import { getBarcodeCache, setBarcodeCache } from '../../lib/barcodeCache'

type ScanResult = 'idle' | 'product' | 'location' | 'unknown' | 'loading'

export function PickerHomePage() {
  const { t } = useTranslation('picker')
  const navigate = useNavigate()
  const location = useLocation()
  const [resultState, setResultState] = useState<ScanResult>('idle')
  const [resultData, setResultData] = useState<{
    product?: { product_id: string; name: string; barcode: string | null; locations: { location_code: string; available_qty: number }[]; fefo_lots: { batch_no: string; expiry_date: string | null; available_qty: number }[]; total_available: number }
    location?: { code: string }
    message?: string
  } | null>(null)
  const [offlineMode, setOfflineMode] = useState(false)

  // Read scan result from navigation state (from PickerLayout scan flow)
  useEffect(() => {
    const state = location.state as { scanResult?: { product?: unknown; offline?: boolean }; scanError?: string } | null
    if (state?.scanResult?.product) {
      const p = state.scanResult.product as {
        product_id: string
        name: string
        barcode: string | null
        locations: { location_code: string; available_qty: number }[]
        fefo_lots: { batch_no: string; expiry_date: string | null; available_qty: number }[]
        total_available: number
      }
      setResultState('product')
      setResultData({
        product: {
          product_id: p.product_id,
          name: p.name,
          barcode: p.barcode,
          locations: p.locations,
          fefo_lots: p.fefo_lots,
          total_available: p.total_available,
        },
      })
      setOfflineMode(Boolean(state.scanResult.offline))
      navigate(location.pathname, { replace: true, state: {} })
    } else if (state?.scanError) {
      setResultState('unknown')
      setResultData({ message: state.scanError === 'unknown' ? t('scan.unknown') : t('inventory.load_error') })
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state, location.pathname, navigate, t])

  const formatExpiry = (d: string | null) => {
    if (!d) return '—'
    try {
      return new Date(d).toLocaleDateString()
    } catch {
      return d
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AppHeader title={t('home.title')} />
      {offlineMode && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <WifiOff size={16} />
          {t('home.offline_warning')}
        </div>
      )}

      {/* Dashboard - main content area */}
      <div className="px-4">

        {/* Result Card */}
        {resultState === 'loading' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
          <div className="h-6 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-4 w-full animate-pulse rounded bg-slate-200" />
        </div>
        )}

        {resultState === 'product' && resultData?.product && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {resultData.product.name}
          </div>
          {resultData.product.barcode && (
            <div className="text-sm text-slate-500">{resultData.product.barcode}</div>
          )}
          <div className="mt-3 text-sm">
            <div className="font-medium text-slate-600 dark:text-slate-400">
              {t('home.locations')}
            </div>
            {resultData.product.locations.length === 0 ? (
              <div className="text-slate-500">—</div>
            ) : (
              <ul className="mt-1 space-y-1">
                {resultData.product.locations.map((l, i) => (
                  <li key={i}>
                    {l.location_code} → {l.available_qty}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {resultData.product.fefo_lots.length > 0 && (
            <div className="mt-3 text-sm">
              <div className="font-medium text-slate-600 dark:text-slate-400">
                {t('home.nearest_expiry')}
              </div>
              <div className="mt-1">
                {resultData.product.fefo_lots[0].batch_no} /{' '}
                {formatExpiry(resultData.product.fefo_lots[0].expiry_date)} →{' '}
                {resultData.product.fefo_lots[0].available_qty}
              </div>
            </div>
          )}
          <div className="mt-3 font-semibold text-slate-900 dark:text-slate-100">
            {t('home.total_available')}: {resultData.product.total_available}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setResultState('idle')}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium dark:border-slate-600"
            >
              {t('home.back_to_scan')}
            </button>
            <button
              type="button"
              onClick={() =>
                resultData.product?.product_id &&
                navigate(`/picker/inventory/${resultData.product.product_id}`)
              }
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white"
            >
              {t('home.view_details')}
            </button>
          </div>
        </div>
        )}

        {resultState === 'unknown' && resultData?.message && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <div className="font-medium text-red-800 dark:text-red-200">{resultData.message}</div>
            <button
              type="button"
              onClick={() => { setResultState('idle'); setResultData(null); }}
              className="mt-3 rounded-xl bg-red-600 px-4 py-2 text-sm text-white"
            >
            {t('home.retry')}
          </button>
        </div>
        )}

        {/* Dashboard - Quick Links */}
        <div className="mt-4 space-y-2">
        <button
          type="button"
          onClick={() => navigate('/picking/mobile-pwa')}
          className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700">
            <ClipboardList size={20} className="text-slate-600 dark:text-slate-300" />
          </div>
          <div className="flex-1 text-left">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              {t('home.my_pick_tasks')}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t('home.pick_tasks_desc')}
            </div>
          </div>
          <span className="text-slate-400">›</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/picker/inventory')}
          className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700">
            <Package size={20} className="text-slate-600 dark:text-slate-300" />
          </div>
          <div className="flex-1 text-left">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              {t('home.inventory')}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t('home.inventory_desc')}
            </div>
          </div>
          <span className="text-slate-400">›</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/offline-queue')}
          className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700">
            <WifiOff size={20} className="text-slate-600 dark:text-slate-300" />
          </div>
          <div className="flex-1 text-left">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              {t('home.offline_queue')}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t('home.offline_queue_desc')}
            </div>
          </div>
          <span className="text-slate-400">›</span>
        </button>
        </div>
      </div>
    </div>
  )
}
