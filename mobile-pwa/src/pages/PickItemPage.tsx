import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Minus, Plus, SkipForward } from 'lucide-react'

import { AppHeader } from '../components/layout/AppHeader'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/EmptyState'
import {
  getPickListDetailsForPicker,
  pickLineDelta,
  type PickLine,
} from '../services/pickingApi'
import { PickItemCard } from '../picking/components/PickItemCard'
import { ScanInput } from '../picking/components/ScanInput'
import { cn } from '../lib/utils'

const CameraScanner = lazy(() => import('../picking/components/CameraScanner'))

export function PickItemPage() {
  const { documentId, lineId } = useParams()
  const navigate = useNavigate()
  const [line, setLine] = useState<PickLine | null>(null)
  const [qty, setQty] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [isPicking, setIsPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [lastScan, setLastScan] = useState<{ code: string; found: boolean } | null>(null)

  const isMobile = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  }, [])

  const normalizeScan = useCallback((value: string) => value.trim().replace(/\s+/g, ''), [])

  const load = useCallback(async () => {
    if (!documentId || !lineId) {
      setError('Mahsulot topilmadi.')
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const details = await getPickListDetailsForPicker(documentId)
      const found = details.lines.find((item) => item.id === lineId) ?? null
      setLine(found)
      if (!found) {
        setError('Mahsulot topilmadi.')
      }
    } catch (err) {
      setError('Mahsulot yuklanmadi.')
    } finally {
      setIsLoading(false)
    }
  }, [documentId, lineId])

  useEffect(() => {
    void load()
  }, [load])

  const remaining = useMemo(() => {
    if (!line) return 0
    return Math.max(0, line.qty_required - line.qty_picked)
  }, [line])

  const handlePick = useCallback(async () => {
    if (!line || remaining === 0) return
    const target = Math.min(remaining, qty)
    if (target <= 0) return
    setIsPicking(true)
    setError(null)
    try {
      for (let i = 0; i < target; i += 1) {
        await pickLineDelta(line.id, 1)
      }
      navigate(`/picking/mobile-pwa/${documentId}`, { replace: true })
    } catch (err) {
      setError('Pick qilishda xato. Qayta urinib ko‘ring.')
    } finally {
      setIsPicking(false)
    }
  }, [documentId, line, navigate, qty, remaining])

  const handleScan = useCallback(
    (code: string) => {
      if (!line) return
      const normalized = normalizeScan(code)
      if (!normalized) return
      const candidates = [
        line.location_code,
        line.product_name,
        (line as { sku?: string }).sku,
        (line as { barcode?: string }).barcode,
      ]
        .filter(Boolean)
        .map((value) => normalizeScan(String(value)))
      const found = candidates.includes(normalized)
      setLastScan({ code: normalized, found })
    },
    [line, normalizeScan]
  )

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title="Pick item" onBack={() => navigate(-1)} />
        <div className="h-40 w-full animate-pulse rounded-2xl bg-slate-200" />
      </div>
    )
  }

  if (!line || error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title="Pick item" onBack={() => navigate(-1)} />
        <EmptyState
          title={error ?? 'Mahsulot topilmadi'}
          actionLabel="Qayta urinib ko‘rish"
          onAction={load}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-10">
      <AppHeader title="Pick item" onBack={() => navigate(-1)} />

      <div className="mb-4 space-y-3">
        <ScanInput onScan={handleScan} />
        {lastScan ? (
          <div
            className={cn(
              'rounded-xl px-3 py-2 text-xs font-semibold',
              lastScan.found ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            )}
          >
            Last scan: {lastScan.code} — {lastScan.found ? 'Found' : 'Not found'}
          </div>
        ) : null}
        <Button fullWidth variant="secondary" onClick={() => setIsCameraActive((prev) => !prev)}>
          {isCameraActive
            ? 'Stop camera'
            : isMobile
              ? 'Scan with camera'
              : 'Camera scan (optional)'}
        </Button>
        <Suspense
          fallback={<div className="rounded-2xl bg-white p-4 text-sm text-slate-500">Loading camera...</div>}
        >
          <CameraScanner
            active={isCameraActive}
            onDetected={(code) => {
              handleScan(code)
              setIsCameraActive(false)
            }}
          />
        </Suspense>
      </div>

      <PickItemCard
        productName={line.product_name}
        locationCode={line.location_code}
        qtyPicked={line.qty_picked}
        qtyRequired={line.qty_required}
        status={line.status}
      />

      <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-slate-700">Qty</div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="secondary" onClick={() => setQty((prev) => Math.max(1, prev - 1))}>
            <Minus size={18} />
          </Button>
          <div className="text-2xl font-semibold text-slate-900">{qty}</div>
          <Button variant="secondary" onClick={() => setQty((prev) => prev + 1)}>
            <Plus size={18} />
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[1, 2, 5].map((quick) => (
            <Button key={quick} variant="outline" onClick={() => setQty(quick)}>
              {quick}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-3">
        <Button fullWidth onClick={handlePick} disabled={isPicking || remaining === 0}>
          {isPicking ? 'Picking...' : 'Pick'}
        </Button>
        <Button fullWidth variant="outline" onClick={() => navigate(-1)}>
          <SkipForward size={18} />
          Skip
        </Button>
      </div>

      {error ? <div className="mt-4 text-sm text-red-600">{error}</div> : null}
    </div>
  )
}
