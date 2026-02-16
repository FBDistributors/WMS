import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Result } from '@zxing/library'
import type { IScannerControls } from '@zxing/browser'

type CameraScannerProps = {
  onDetected: (code: string) => void
  onError?: (message: string) => void
  onClose?: () => void
  active: boolean
  fullscreen?: boolean
  scanError?: string | null
}

// 640x480 — mahsulotni scan qilish uchun mos yaqin fokus (1280x720 uzoq fokus qilardi)
const VIDEO_CONSTRAINTS: MediaStreamConstraints['video'] = {
  facingMode: 'environment',
  width: { ideal: 640 },
  height: { ideal: 480 },
}

const SCANNER_OPTIONS = {
  delayBetweenScanAttempts: 100,
  delayBetweenScanSuccess: 100,
}

export default function CameraScanner({ onDetected, onError, onClose, active, fullscreen = false, scanError: scanErr }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected

  useEffect(() => {
    if (!active) return
    let isCancelled = false
    let controls: IScannerControls | null = null

    const start = async () => {
      const video = videoRef.current
      if (!video) return
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (isCancelled) return
        const reader = new BrowserMultiFormatReader(undefined, SCANNER_OPTIONS)
        controls = await reader.decodeFromConstraints(
          { video: VIDEO_CONSTRAINTS },
          video,
          (result: Result | undefined, _err, ctrl) => {
            if (!result) return
            const text = result.getText()
            if (!text) return
            onDetectedRef.current(text)
            ctrl.stop()
          }
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Camera error'
        setError(message)
        onError?.(message)
      }
    }

    const run = () => {
      requestAnimationFrame(() => {
        if (videoRef.current && !isCancelled) void start()
      })
    }
    run()

    return () => {
      isCancelled = true
      controls?.stop()
    }
  }, [active, onError])

  if (!active) return null

  const containerClass = fullscreen
    ? 'fixed inset-0 z-[60] flex flex-col bg-black'
    : 'rounded-2xl bg-white p-4 shadow-sm'

  return (
    <div className={containerClass}>
      {fullscreen && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
          aria-label="Close camera"
        >
          <X size={24} />
        </button>
      )}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={fullscreen ? 'h-full w-full object-cover' : 'h-56 w-full rounded-xl object-cover'}
        />
      </div>
      {(error || scanErr) ? (
        <div className="absolute bottom-4 left-4 right-4 rounded-lg bg-red-600 px-4 py-2 text-sm text-white">
          {error || scanErr}
        </div>
      ) : null}
    </div>
  )
}
