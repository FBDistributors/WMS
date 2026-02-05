import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Minus, Plus, ScanLine, SkipForward } from 'lucide-react'

import { AppHeader } from '../components/layout/AppHeader'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/EmptyState'
import { getPickListDetails, pickLineDelta, type PickLine } from '../services/pickingApi'

export function PickItemPage() {
  const { documentId, lineId } = useParams()
  const navigate = useNavigate()
  const [line, setLine] = useState<PickLine | null>(null)
  const [qty, setQty] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [isPicking, setIsPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!documentId || !lineId) {
      setError('Mahsulot topilmadi.')
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const details = await getPickListDetails(documentId)
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

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="text-sm text-slate-500">Product</div>
        <div className="text-xl font-semibold text-slate-900">{line.product_name}</div>
        <div className="mt-4 rounded-2xl bg-slate-100 p-6 text-center">
          <div className="text-xs uppercase text-slate-500">Location</div>
          <div className="text-3xl font-bold text-slate-900">{line.location_code}</div>
        </div>
        <div className="mt-4 text-sm text-slate-600">
          Qty remaining: <span className="font-semibold">{remaining}</span>
        </div>
      </div>

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
        <Button fullWidth variant="secondary" onClick={() => alert('Scan coming soon')}>
          <ScanLine size={18} />
          Scan
        </Button>
      </div>

      {error ? <div className="mt-4 text-sm text-red-600">{error}</div> : null}
    </div>
  )
}
