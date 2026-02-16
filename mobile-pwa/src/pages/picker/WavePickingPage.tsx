import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/EmptyState'
import { getWave, pickScan, type WaveOut, type WaveLineOut } from '../../services/wavesApi'
import { ScanInput } from '../../picking/components/ScanInput'

const CameraScanner = lazy(() => import('../../picking/components/CameraScanner'))

export function WavePickingPage() {
  const { waveId } = useParams<{ waveId: string }>()
  const { t } = useTranslation(['picking', 'admin'])
  const navigate = useNavigate()

  const [wave, setWave] = useState<WaveOut | null>(null)
  const [currentLine, setCurrentLine] = useState<WaveLineOut | null>(null)
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

  const handleScan = useCallback(
    async (code: string) => {
      if (!wave || wave.status !== 'PICKING') return
      const barcode = code.trim()
      const line = wave.lines.find((l) => l.barcode === barcode)
      if (!line) {
        setLastResult({ success: false, msg: t('picking:wave.scan_error') })
        setCurrentLine(null)
        return
      }
      const remaining = Number(line.total_qty) - Number(line.picked_qty)
      if (remaining <= 0) {
        setLastResult({ success: false, msg: 'Already fully picked' })
        setCurrentLine(null)
        return
      }
      setCurrentLine(line)
      setQty(Math.min(1, remaining))
      setLastResult(null)
    },
    [wave, t]
  )

  const handleConfirm = useCallback(async () => {
    if (!waveId || !currentLine || qty <= 0) return
    const remaining = Number(currentLine.total_qty) - Number(currentLine.picked_qty)
    const toPick = Math.min(qty, remaining)
    if (toPick <= 0) return

    setIsSubmitting(true)
    setError(null)
    try {
      await pickScan(waveId, {
        barcode: currentLine.barcode,
        qty: toPick,
        request_id: crypto.randomUUID(),
      })
      setLastResult({ success: true, msg: t('picking:wave.scan_success', { qty: toPick }) })
      setCurrentLine(null)
      void load()
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : t('picking:pick_failed')
      setLastResult({ success: false, msg })
    } finally {
      setIsSubmitting(false)
    }
  }, [currentLine, load, qty, t, waveId])

  const remaining = useMemo(() => {
    if (!currentLine) return 0
    return Math.max(0, Number(currentLine.total_qty) - Number(currentLine.picked_qty))
  }, [currentLine])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title={t('picking:wave.title')} onBack={() => navigate(-1)} hideUserMenu />
        <div className="h-40 w-full animate-pulse rounded-2xl bg-slate-200" />
      </div>
    )
  }

  if (!wave || error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title={t('picking:wave.title')} onBack={() => navigate(-1)} hideUserMenu />
        <EmptyState title={error ?? 'Wave not found'} actionLabel={t('common:buttons.retry')} onAction={load} />
      </div>
    )
  }

  if (wave.status !== 'PICKING') {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title={t('picking:wave.title')} onBack={() => navigate(-1)} hideUserMenu />
        <EmptyState
          title={t('picking:wave.no_waves')}
          description={`Wave status: ${wave.status}`}
          actionLabel={t('common:buttons.back')}
          onAction={() => navigate(-1)}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-24">
      <AppHeader title={`${wave.wave_number} – ${t('picking:wave.title')}`} onBack={() => navigate(-1)} hideUserMenu />

      <div className="mb-4 space-y-3">
        <ScanInput onScan={handleScan} placeholder={t('picking:wave.scan_barcode')} />
        <Button fullWidth variant="secondary" onClick={() => setIsCameraActive((p) => !p)}>
          {isCameraActive ? t('stop_camera') : isMobile ? t('scan_camera') : t('camera_optional')}
        </Button>
        <Suspense fallback={<div className="rounded-2xl bg-white p-4 text-sm text-slate-500">{t('loading_camera')}</div>}>
          <CameraScanner
            active={isCameraActive}
            onDetected={(code) => {
              handleScan(code)
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

      {currentLine ? (
        <div className="mb-6 rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">
            {currentLine.product_name ?? currentLine.product_sku ?? currentLine.barcode}
          </div>
          {currentLine.brand && (
            <div className="text-sm text-slate-500">{currentLine.brand}</div>
          )}
          <div className="mt-2 flex justify-between text-sm">
            <span>{t('picking:wave.picked')}: {Number(currentLine.picked_qty)} / {Number(currentLine.total_qty)}</span>
            <span className="font-medium">{t('picking:wave.remaining')}: {remaining}</span>
          </div>
          {currentLine.allocations && currentLine.allocations.length > 0 && (
            <div className="mt-2 text-xs text-slate-500">
              From: {currentLine.allocations.map((a) => a.location_code).join(', ')}
            </div>
          )}
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setQty((p) => Math.max(1, p - 1))}>
                <Minus size={18} />
              </Button>
              <span className="w-8 text-center text-lg font-semibold">{qty}</span>
              <Button variant="secondary" size="sm" onClick={() => setQty((p) => Math.min(remaining, p + 1))}>
                <Plus size={18} />
              </Button>
            </div>
            <Button onClick={handleConfirm} disabled={isSubmitting || qty > remaining}>
              {isSubmitting ? t('picking') : t('picking:wave.confirm')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-white p-4 text-center text-slate-500">
          {t('picking:wave.scan_barcode')}
        </div>
      )}

      <div className="mt-4 space-y-2">
        <div className="text-sm font-medium text-slate-700">{t('picking:lines_label', { done: wave.lines.filter((l) => l.status === 'PICKED').length, total: wave.lines.length })}</div>
        {wave.lines
          .filter((l) => l.status !== 'PICKED')
          .slice(0, 10)
          .map((l) => (
            <div key={l.id} className="rounded-lg bg-white px-3 py-2 text-sm">
              {l.barcode} – {l.product_name ?? l.product_sku} ({Number(l.picked_qty)}/{Number(l.total_qty)})
            </div>
          ))}
      </div>
    </div>
  )
}
