/**
 * Lightweight Scan Validate component for picking flow.
 * Step 1: scan LOCATION -> resolve must return LOCATION
 * Step 2: scan PRODUCT -> resolve must return PRODUCT
 * Step 3: user enters qty (+ / - buttons)
 * Step 4: Confirm -> (integrates with offline queue when implemented)
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin, Package, Plus, Minus } from 'lucide-react'
import { Button } from '../ui/button'
import { ScanModal } from './ScanModal'
import { resolveBarcode } from '../../services/scannerApi'

type ScanValidateProps = {
  onConfirm?: (payload: { locationId: string; productId: string; qty: number }) => void
}

export function ScanValidate({ onConfirm }: ScanValidateProps) {
  const { t } = useTranslation('picker')
  const [step, setStep] = useState<1 | 2>(1)
  const [locationId, setLocationId] = useState<string | null>(null)
  const [locationLabel, setLocationLabel] = useState<string | null>(null)
  const [productId, setProductId] = useState<string | null>(null)
  const [productLabel, setProductLabel] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [scanOpen, setScanOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleScanned = async (barcode: string) => {
    setScanOpen(false)
    setError(null)
    try {
      const res = await resolveBarcode(barcode)
      if (step === 1) {
        if (res.type === 'LOCATION' && res.entity_id) {
          setLocationId(res.entity_id)
          setLocationLabel(res.display_label ?? res.entity_id)
          setStep(2)
        } else {
          setError(t('scan.unknown') + ' (LOCATION expected)')
        }
      } else {
        if (res.type === 'PRODUCT' && res.entity_id) {
          setProductId(res.entity_id)
          setProductLabel(res.display_label ?? res.entity_id)
        } else {
          setError(t('scan.unknown') + ' (PRODUCT expected)')
        }
      }
    } catch {
      setError(t('inventory.load_error'))
    }
  }

  const handleConfirm = () => {
    if (locationId && productId) {
      onConfirm?.({ locationId, productId, qty })
    }
  }

  const reset = () => {
    setStep(1)
    setLocationId(null)
    setLocationLabel(null)
    setProductId(null)
    setProductLabel(null)
    setQty(1)
    setError(null)
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="text-sm font-medium text-slate-600 dark:text-slate-400">
        {step === 1 ? '1. Scan location' : '2. Scan product'}
      </div>
      {step === 1 && (
        <div className="flex items-center gap-2">
          <MapPin size={20} className="text-slate-400" />
          <span className="text-sm">
            {locationLabel ?? '—'}
          </span>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setScanOpen(true)}>
            Scan
          </Button>
        </div>
      )}
      {step === 2 && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <MapPin size={16} />
            {locationLabel}
          </div>
          <div className="flex items-center gap-2">
            <Package size={20} className="text-slate-400" />
            <span className="text-sm">{productLabel ?? '—'}</span>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setScanOpen(true)}>
              Scan
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setQty((prev) => Math.max(0, prev - 1))}
            >
              <Minus size={18} />
            </Button>
            <span className="min-w-[2rem] text-center font-medium">{qty}</span>
            <Button variant="ghost" onClick={() => setQty((prev) => prev + 1)}>
              <Plus size={18} />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={reset}>
              Reset
            </Button>
            <Button onClick={handleConfirm} disabled={!productId}>
              Confirm
            </Button>
          </div>
        </>
      )}
      {error && <div className="text-sm text-red-600">{error}</div>}
      <ScanModal open={scanOpen} onClose={() => setScanOpen(false)} onScanned={handleScanned} />
    </div>
  )
}
