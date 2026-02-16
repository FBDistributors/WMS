import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/EmptyState'
import { getWave, sortingScan, type WaveOut, type SortingBinOut } from '../../services/wavesApi'
import { ScanInput } from '../../picking/components/ScanInput'

const CameraScanner = lazy(() => import('../../picking/components/CameraScanner'))

export function WaveSortingPage() {
  const { waveId } = useParams<{ waveId: string }>()
  const { t } = useTranslation(['picking', 'admin'])
  const navigate = useNavigate()

  const [wave, setWave] = useState<WaveOut | null>(null)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [barcode, setBarcode] = useState('')
  const [qty, setQty] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{ success: boolean; msg: string } | null>(null)
  const [isCameraActive, setIsCameraActive] = useState(false)

  const isMobile = useMemo(
    () => (typeof navigator !== 'undefined' ? /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) : false),
    []
  )

  const load = useCallback(async () => {
    if (!waveId) return
    setIsLoading(true)
    setError(null)
    try {
      const w = await getWave(waveId)
      setWave(w)
    } catch {
      setError(t('picking:load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [waveId, t])

  useEffect(() => {
    void load()
  }, [load])

  const handleScanBarcode = useCallback((code: string) => {
    setBarcode(code.trim())
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!waveId || !selectedOrderId || !barcode || qty <= 0) return

    setIsSubmitting(true)
    setError(null)
    try {
      await sortingScan(waveId, {
        order_id: selectedOrderId,
        barcode,
        qty,
        request_id: crypto.randomUUID(),
      })
      setLastResult({ success: true, msg: t('picking:sorting.scan_success', { qty }) })
      setBarcode('')
      void load()
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : 'Scan failed'
      setLastResult({ success: false, msg })
    } finally {
      setIsSubmitting(false)
    }
  }, [barcode, load, qty, selectedOrderId, t, waveId])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title={t('picking:sorting.title')} onBack={() => navigate(-1)} hideUserMenu />
        <div className="h-40 w-full animate-pulse rounded-2xl bg-slate-200" />
      </div>
    )
  }

  if (!wave || error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title={t('picking:sorting.title')} onBack={() => navigate(-1)} hideUserMenu />
        <EmptyState title={error ?? 'Wave not found'} actionLabel={t('common:buttons.retry')} onAction={load} />
      </div>
    )
  }

  if (wave.status !== 'SORTING') {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title={t('picking:sorting.title')} onBack={() => navigate(-1)} hideUserMenu />
        <EmptyState
          title={t('picking:wave.no_waves')}
          description={`Wave status: ${wave.status}`}
          actionLabel={t('common:buttons.back')}
          onAction={() => navigate(-1)}
        />
      </div>
    )
  }

  const bins = wave.bins ?? []
  const selectedBin = bins.find((b) => b.order_id === selectedOrderId)
  const order = wave.orders.find((o) => o.id === selectedOrderId)

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-24">
      <AppHeader title={`${wave.wave_number} – ${t('picking:sorting.title')}`} onBack={() => navigate(-1)} hideUserMenu />

      <div className="mb-4 space-y-3">
        <div className="text-sm font-medium text-slate-700">{t('picking:sorting.select_order')}</div>
        <div className="flex flex-wrap gap-2">
          {bins.map((b) => {
            const ord = wave.orders.find((o) => o.id === b.order_id)
            const isSelected = selectedOrderId === b.order_id
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedOrderId(b.order_id)}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  isSelected
                    ? 'bg-blue-600 text-white'
                    : b.status === 'DONE'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/50'
                      : 'bg-white text-slate-700 shadow-sm hover:bg-slate-50 dark:bg-slate-800'
                }`}
              >
                {b.bin_code} {ord?.order_number}
                {b.status === 'DONE' && ' ✓'}
              </button>
            )
          })}
        </div>
      </div>

      {selectedOrderId && (
        <>
          <div className="mb-4 space-y-3">
            <ScanInput onScan={handleScanBarcode} placeholder={t('picking:sorting.scan_barcode')} />
            <Button fullWidth variant="secondary" onClick={() => setIsCameraActive((p) => !p)}>
              {isCameraActive ? t('stop_camera') : isMobile ? t('scan_camera') : t('camera_optional')}
            </Button>
            <Suspense fallback={<div className="rounded-2xl bg-white p-4 text-sm text-slate-500">{t('loading_camera')}</div>}>
              <CameraScanner
                active={isCameraActive}
                onDetected={(code) => {
                  handleScanBarcode(code)
                  setIsCameraActive(false)
                }}
              />
            </Suspense>
          </div>

          {lastResult && (
            <div
              className={`mb-4 rounded-xl px-3 py-2 text-sm font-medium ${
                lastResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
              }`}
            >
              {lastResult.msg}
            </div>
          )}

          {barcode && (
            <div className="mb-6 rounded-2xl bg-white p-4 shadow-sm">
              <div className="text-sm text-slate-500">Barcode: {barcode}</div>
              <div className="mt-2 text-sm text-slate-700">
                Assign to: {order?.order_number} ({selectedBin?.bin_code})
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{t('picking:sorting.assign_qty')}:</span>
                  <Button variant="secondary" size="sm" onClick={() => setQty((p) => Math.max(1, p - 1))}>
                    <Minus size={18} />
                  </Button>
                  <span className="w-8 text-center text-lg font-semibold">{qty}</span>
                  <Button variant="secondary" size="sm" onClick={() => setQty((p) => p + 1)}>
                    <Plus size={18} />
                  </Button>
                </div>
                <Button onClick={handleConfirm} disabled={isSubmitting}>
                  {isSubmitting ? '...' : t('picking:sorting.confirm')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {!selectedOrderId && (
        <div className="rounded-2xl bg-white p-4 text-center text-slate-500">
          {t('picking:sorting.select_order')}
        </div>
      )}
    </div>
  )
}
