import { Suspense, lazy, useCallback, useMemo, useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { pickLineDelta } from '../../services/pickingApi'
import type { PickLine } from '../../services/pickingApi'
import { ScanInput } from './ScanInput'
import { cn } from '../../lib/utils'
import { playBeep, playErrorBeep, vibrateError } from '../../utils/beep'

const CameraScanner = lazy(() => import('./CameraScanner'))

function normalizeScan(value: string) {
  return value.trim().replace(/\s+/g, '')
}

type PickScanModalProps = {
  open: boolean
  line: PickLine | null
  onClose: () => void
  onSuccess: () => void
}

export function PickScanModal({ open, line, onClose, onSuccess }: PickScanModalProps) {
  const { t } = useTranslation('picking')
  const [barcodeScanned, setBarcodeScanned] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [isPicking, setIsPicking] = useState(false)
  const [isCameraActive, setIsCameraActive] = useState(false)

  const isMobile = useMemo(
    () =>
      typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    []
  )

  const remaining = useMemo(() => {
    if (!line) return 0
    return Math.max(0, line.qty_required - line.qty_picked)
  }, [line])

  const handleScan = useCallback(
    (code: string) => {
      if (!line) return
      setScanError(null)
      const normalized = normalizeScan(code)
      if (!normalized) return
      const candidates = [
        line.location_code,
        line.product_name,
        line.sku,
        line.barcode,
      ]
        .filter(Boolean)
        .map((v) => normalizeScan(String(v)))
      const found = candidates.includes(normalized)
      if (found) {
        playBeep()
        setBarcodeScanned(true)
        setScanError(null)
        setQty(Math.min(1, remaining))
        setIsCameraActive(false)
      } else {
        playErrorBeep()
        vibrateError()
        setScanError(t('not_found'))
      }
    },
    [line, remaining, t]
  )

  const handleConfirm = useCallback(async () => {
    if (!line || remaining <= 0) return
    const toPick = Math.min(qty, remaining)
    if (toPick <= 0) return
    setIsPicking(true)
    try {
      for (let i = 0; i < toPick; i += 1) {
        await pickLineDelta(line.id, 1)
      }
      onSuccess()
      onClose()
    } finally {
      setIsPicking(false)
    }
  }, [line, onClose, onSuccess, qty, remaining])

  const handleClose = useCallback(() => {
    setBarcodeScanned(false)
    setScanError(null)
    setQty(1)
    setIsCameraActive(false)
    onClose()
  }, [onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white shadow-xl dark:bg-slate-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {line ? line.product_name : ''}
          </h2>
          <button
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            onClick={handleClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
          {line && (
            <>
              <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
                <div className="font-medium text-slate-700 dark:text-slate-300">
                  {line.location_code}
                </div>
                <div className="text-slate-600 dark:text-slate-400">
                  {t('progress_line', { picked: line.qty_picked, required: line.qty_required })}
                </div>
              </div>

              {!barcodeScanned ? (
                <>
                  <ScanInput onScan={handleScan} placeholder={t('scan_placeholder')} />
                  <Button
                    fullWidth
                    variant="secondary"
                    onClick={() => setIsCameraActive((p) => !p)}
                  >
                    {isCameraActive ? t('stop_camera') : isMobile ? t('scan_camera') : t('camera_optional')}
                  </Button>
                  {isCameraActive && (
                    <Suspense
                      fallback={
                        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black text-white">
                          {t('loading_camera')}
                        </div>
                      }
                    >
                      <CameraScanner
                        active={true}
                        fullscreen
                        scanError={scanError}
                        onClose={() => setIsCameraActive(false)}
                        onDetected={handleScan}
                      />
                    </Suspense>
                  )}
                  {scanError && (
                    <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
                      {scanError}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div
                    className={cn(
                      'rounded-xl px-3 py-2 text-sm font-medium',
                      'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                    )}
                  >
                    {t('found')}
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('qty')}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        variant="secondary"
                        className="px-3 py-2"
                        onClick={() => setQty((p) => Math.max(1, p - 1))}
                      >
                        <Minus size={18} />
                      </Button>
                      <span className="w-12 text-center text-xl font-semibold">{qty}</span>
                      <Button
                        variant="secondary"
                        className="px-3 py-2"
                        onClick={() => setQty((p) => Math.min(remaining, p + 1))}
                      >
                        <Plus size={18} />
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      {[1, 2, 5].map((n) => (
                        <Button
                          key={n}
                          variant="outline"
                          className="flex-1"
                          onClick={() => setQty(Math.min(n, remaining))}
                        >
                          {n}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Button
                    fullWidth
                    onClick={handleConfirm}
                    disabled={isPicking || remaining <= 0 || qty > remaining}
                  >
                    {isPicking ? t('picking') : t('pick')}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
