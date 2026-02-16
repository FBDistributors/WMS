import { useCallback, useEffect, useRef, useState } from 'react'
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

/** Asosiy (1x) kamera + continuous autofocus — mahsulot skaner uchun optimal */
async function getMainCameraStream(): Promise<MediaStream> {
  const supported = navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean>
  const hasFocusMode = supported.focusMode === true

  const baseConstraints: MediaTrackConstraints = {
    facingMode: { exact: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    ...(hasFocusMode && { focusMode: 'continuous' }),
  }

  let preferredId: string | undefined
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const videoInputs = devices.filter((d) => d.kind === 'videoinput')
    const label = (d: MediaDeviceInfo) => (d.label || '').toLowerCase()
    const isFront = (d: MediaDeviceInfo) => /front|selfie|user|facing/i.test(label(d))
    const isBack = (d: MediaDeviceInfo) => /back|rear|environment|asosiy|orqa/i.test(label(d))
    const backCameras = videoInputs.filter((d) => isBack(d) && !isFront(d))
    const candidates = backCameras.length ? backCameras : videoInputs.filter((d) => !isFront(d))
    const mainCameras = candidates.filter(
      (d) => !/ultra|0\.5x|macro|fisheye/i.test(label(d)) || candidates.length === 1
    )
    if (mainCameras.length && (backCameras.length > 0 || !label(mainCameras[0]))) {
      preferredId = mainCameras[0]?.deviceId
    }
  } catch {
    // fallback
  }

  const constraints: MediaTrackConstraints = preferredId
    ? { ...baseConstraints, deviceId: { exact: preferredId } }
    : baseConstraints

  const stream = await navigator.mediaDevices.getUserMedia({ video: constraints })

  const track = stream.getVideoTracks()[0]
  if (track && hasFocusMode) {
    try {
      await track.applyConstraints({ focusMode: 'continuous' } as MediaTrackConstraints)
    } catch {
      // ignore
    }
  }

  return stream
}

const SCANNER_OPTIONS = {
  delayBetweenScanAttempts: 150,
  delayBetweenScanSuccess: 150,
}

// TRY_HARDER = 3 — kichik shtrix-kodlar uchun aniqroq o‘qish
const DECODE_HINTS = new Map<number, unknown>([[3, true]])

export default function CameraScanner({ onDetected, onError, onClose, active, fullscreen = false, scanError: scanErr }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected

  const handleVideoTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const video = videoRef.current
    const track = trackRef.current
    if (!video || !track || video.readyState < 2) return
    const caps = track.getCapabilities ? track.getCapabilities() : {}
    if (!('pointsOfInterest' in caps)) return
    const rect = video.getBoundingClientRect()
    const te = e as unknown as TouchEvent
    const touch = te.touches?.[0] ?? te.changedTouches?.[0]
    const x = touch ? touch.clientX : (e as React.MouseEvent).clientX
    const y = touch ? touch.clientY : (e as React.MouseEvent).clientY
    if (x == null || y == null) return
    const nx = Math.max(0, Math.min(1, (x - rect.left) / rect.width))
    const ny = Math.max(0, Math.min(1, (y - rect.top) / rect.height))
    track.applyConstraints({ pointsOfInterest: [{ x: nx, y: ny }] } as MediaTrackConstraints).catch(() => {})
  }, [])

  useEffect(() => {
    if (!active) return
    let isCancelled = false
    let controls: IScannerControls | null = null

    const start = async () => {
      const video = videoRef.current
      if (!video) return
      try {
        const stream = await getMainCameraStream()
        trackRef.current = stream.getVideoTracks()[0] ?? null
        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop())
          trackRef.current = null
          return
        }
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop())
          trackRef.current = null
          return
        }
        const reader = new BrowserMultiFormatReader(DECODE_HINTS, SCANNER_OPTIONS)
        controls = await reader.decodeFromStream(
          stream,
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
      trackRef.current = null
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
      <div
        className="relative flex-1 overflow-hidden cursor-default"
        onClick={handleVideoTap}
        onTouchEnd={(e) => e.changedTouches[0] && handleVideoTap(e)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleVideoTap(e as unknown as React.MouseEvent)}
      >
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
