import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Scan, ClipboardList, Package, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { ScanModal } from '../../components/picker/ScanModal'
import { resolveBarcode } from '../../services/scannerApi'
import { getInventoryByBarcode } from '../../services/pickerInventoryApi'
import { getBarcodeCache, setBarcodeCache } from '../../lib/barcodeCache'

type ScanResult = 'idle' | 'product' | 'location' | 'unknown' | 'loading'

export function PickerHomePage() {
  const { t } = useTranslation('picker')
  const navigate = useNavigate()
  const [scanOpen, setScanOpen] = useState(false)
  const [resultState, setResultState] = useState<ScanResult>('idle')
  const [resultData, setResultData] = useState<{
    product?: { product_id: string; name: string; barcode: string | null; locations: { location_code: string; available_qty: number }[]; fefo_lots: { batch_no: string; expiry_date: string | null; available_qty: number }[]; total_available: number }
    location?: { code: string }
    message?: string
  } | null>(null)
  const [offlineMode, setOfflineMode] = useState(false)

  const handleScanned = useCallback(
    async (barcode: string) => {
      setScanOpen(false)
      setResultState('loading')
      setResultData(null)
      setOfflineMode(false)

      try {
        const resolveRes = await resolveBarcode(barcode)
        if (resolveRes.type === 'PRODUCT' && resolveRes.product) {
          try {
            const inv = await getInventoryByBarcode(barcode)
            setBarcodeCache(barcode, inv)
            setResultState('product')
            setResultData({
              product: {
                product_id: inv.product_id,
                name: inv.name,
                barcode: inv.barcode,
                locations: inv.best_locations.map((l) => ({
                  location_code: l.location_code,
                  available_qty: l.available_qty,
                })),
                fefo_lots: inv.fefo_lots.map((l) => ({
                  batch_no: l.batch_no,
                  expiry_date: l.expiry_date,
                  available_qty: l.available_qty,
                })),
                total_available: inv.total_available,
              },
            })
          } catch (err) {
            const cached = getBarcodeCache(barcode)
            if (cached) {
              setOfflineMode(true)
              setResultState('product')
            setResultData({
              product: {
                product_id: cached.product_id,
                name: cached.name,
                barcode: cached.barcode,
                locations: cached.best_locations,
                fefo_lots: cached.fefo_lots,
                total_available: cached.total_available,
              },
            })
            } else {
              setResultState('unknown')
              setResultData({ message: t('scan.unknown') })
            }
          }
        } else if (resolveRes.type === 'LOCATION' && resolveRes.location) {
          setResultState('location')
          setResultData({ location: { code: resolveRes.location.code } })
          navigate(`/picker/inventory?location=${resolveRes.entity_id}`)
        } else {
          setResultState('unknown')
          setResultData({ message: resolveRes.message ?? t('scan.unknown') })
        }
      } catch {
        const cached = getBarcodeCache(barcode)
        if (cached) {
          setOfflineMode(true)
          setResultState('product')
            setResultData({
              product: {
                product_id: cached.product_id,
                name: cached.name,
                barcode: cached.barcode,
                locations: cached.best_locations,
                fefo_lots: cached.fefo_lots,
                total_available: cached.total_available,
              },
            })
        } else {
          setResultState('unknown')
          setResultData({ message: t('inventory.load_error') })
        }
      }
    },
    [navigate, t]
  )

  const formatExpiry = (d: string | null) => {
    if (!d) return '—'
    try {
      return new Date(d).toLocaleDateString()
    } catch {
      return d
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-6 dark:bg-slate-950">
      <AppHeader title={t('home.title')} />
      {offlineMode && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <WifiOff size={16} />
          {t('home.offline_warning')}
        </div>
      )}

      {/* Center Scan Button */}
      <div className="flex flex-col items-center py-12">
        <button
          type="button"
          onClick={() => setScanOpen(true)}
          className="flex h-32 w-32 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 active:scale-95"
          aria-label={t('home.scan_button')}
        >
          <Scan size={48} />
        </button>
        <p className="mt-4 text-lg font-medium text-slate-700 dark:text-slate-300">
          {t('home.scan_button')}
        </p>
      </div>

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
            onClick={() => setScanOpen(true)}
            className="mt-3 rounded-xl bg-red-600 px-4 py-2 text-sm text-white"
          >
            {t('home.retry')}
          </button>
        </div>
      )}

      {/* Quick Links */}
      <div className="mt-8 space-y-3">
        <button
          type="button"
          onClick={() => navigate('/picking/mobile-pwa')}
          className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <ClipboardList size={24} className="text-slate-500" />
          <div className="text-left">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              {t('home.my_pick_tasks')}
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => navigate('/picker/inventory')}
          className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <Package size={24} className="text-slate-500" />
          <div className="text-left">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              {t('home.inventory')}
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => navigate('/offline-queue')}
          className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <WifiOff size={24} className="text-slate-500" />
          <div className="text-left">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              {t('home.offline_queue')}
            </div>
          </div>
        </button>
      </div>

      <ScanModal open={scanOpen} onClose={() => setScanOpen(false)} onScanned={handleScanned} />
    </div>
  )
}
