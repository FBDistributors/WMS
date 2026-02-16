import { useEffect, useRef, useState } from 'react'
import type { Result } from '@zxing/library'
import type { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser'

type CameraScannerProps = {
  onDetected: (code: string) => void
  onError?: (message: string) => void
  active: boolean
}

const VIDEO_CONSTRAINTS: MediaStreamConstraints['video'] = {
  facingMode: 'environment',
  width: { ideal: 1280, min: 640 },
  height: { ideal: 720, min: 480 },
}

const SCANNER_OPTIONS = {
  delayBetweenScanAttempts: 100,
  delayBetweenScanSuccess: 100,
}

export default function CameraScanner({ onDetected, onError, active }: CameraScannerProps) {
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

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-xs uppercase text-slate-500">Camera scan</div>
      <div className="mt-3 overflow-hidden rounded-xl bg-slate-100">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-56 w-full object-cover"
        />
      </div>
      {error ? <div className="mt-2 text-xs text-red-600">{error}</div> : null}
    </div>
  )
}
