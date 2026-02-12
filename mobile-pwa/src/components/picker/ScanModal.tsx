import { lazy, Suspense, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'

const CameraScanner = lazy(() => import('../../picking/components/CameraScanner'))

type ScanModalProps = {
  open: boolean
  onClose: () => void
  onScanned: (barcode: string) => void
  title?: string
}

export function ScanModal({ open, onClose, onScanned, title }: ScanModalProps) {
  const { t } = useTranslation('picker')
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const handleDetected = (code: string) => {
    onScanned(code)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="relative w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {title ?? t('scan.title')}
          </h2>
          <Button variant="ghost" onClick={onClose} aria-label={t('scan.close')}>
            <X size={20} />
          </Button>
        </div>
        <Suspense fallback={<div className="h-56 animate-pulse rounded-xl bg-slate-200" />}>
          <CameraScanner
            active={open}
            onDetected={handleDetected}
            onError={setError}
          />
        </Suspense>
        {error ? (
          <div className="mt-2 text-sm text-red-600">{error}</div>
        ) : null}
      </div>
    </div>
  )
}
