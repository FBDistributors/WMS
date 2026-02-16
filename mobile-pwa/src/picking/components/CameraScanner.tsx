import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Zap, RotateCcw, Camera } from 'lucide-react'
import type { Result } from '@zxing/library'
import type { IScannerControls } from '@zxing/browser'
import {
  listBackCameras,
  buildVideoConstraints,
  startStream,
  stopStream,
  getTrackCapabilities,
  getDefaultZoom,
  setTorch,
  setZoom,
  focusAtPoint,
  type CameraDevice,
  type TrackCapabilities,
} from '../../utils/cameraUtils'

type CameraScannerProps = {
  onDetected: (code: string) => void
  onError?: (message: string) => void
  onClose?: () => void
  active: boolean
  fullscreen?: boolean
  scanError?: string | null
}

const SCANNER_OPTIONS = {
  delayBetweenScanAttempts: 120,
  delayBetweenScanSuccess: 120,
}

// DecodeHintType: TRY_HARDER=3, POSSIBLE_FORMATS=2
// BarcodeFormat: CODE_39=2, CODE_128=4, EAN_8=6, EAN_13=7
const DECODE_HINTS = new Map<number, unknown>([
  [3, true],
  [2, [2, 4, 6, 7]],
])

export default function CameraScanner({
  onDetected,
  onError,
  onClose,
  active,
  fullscreen = false,
  scanError: scanErr,
}: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected

  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<CameraDevice[]>([])
  const [currentDeviceId, setCurrentDeviceId] = useState<string | undefined>()
  const [torchOn, setTorchOn] = useState(false)
  const [zoomVal, setZoomVal] = useState(1)
  const [caps, setCaps] = useState<TrackCapabilities | null>(null)
  const [useFallback, setUseFallback] = useState(false)

  const cleanup = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    stopStream(streamRef.current)
    streamRef.current = null
    trackRef.current = null
    setCaps(null)
    setTorchOn(false)
  }, [])

  const startZXing = useCallback(
    async (stream: MediaStream, video: HTMLVideoElement) => {
      const { BrowserMultiFormatReader } = await import('@zxing/browser')
      const reader = new BrowserMultiFormatReader(DECODE_HINTS, SCANNER_OPTIONS)
      const ctrl = await reader.decodeFromStream(
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
      controlsRef.current = ctrl
    },
    []
  )

  const attachStreamToVideo = useCallback((stream: MediaStream, video: HTMLVideoElement) => {
    video.srcObject = stream
    video.setAttribute('playsInline', 'true')
    video.setAttribute('muted', 'true')
    video.setAttribute('autoplay', 'true')
    return video.play()
  }, [])

  const runScanner = useCallback(async () => {
    const video = videoRef.current
    if (!video) return
    setError(null)
    try {
      const deviceList = await listBackCameras()
      setDevices(deviceList)
      const deviceId = currentDeviceId ?? deviceList[0]?.deviceId
      let stream: MediaStream
      try {
        stream = await startStream(buildVideoConstraints(deviceId, true))
      } catch {
        stream = await startStream(buildVideoConstraints(deviceId, false))
      }
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      trackRef.current = track ?? null
      const trackCaps = getTrackCapabilities(track ?? null)
      setCaps(trackCaps)
      const initialZoom = getDefaultZoom(trackCaps)
      setZoomVal(initialZoom)
      await setZoom(track ?? null, initialZoom)
      await attachStreamToVideo(stream, video)
      await new Promise((r) => setTimeout(r, 200))
      await startZXing(stream, video)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera error'
      setError(msg)
      onError?.(msg)
      if (/Permission|denied|NotAllowed|NotFound|NotReadable|Overconstrained/i.test(String(msg))) {
        setError('Camera error. Use HTTPS, grant permission, and ensure no other app is using the camera.')
      }
    }
  }, [currentDeviceId, startZXing, attachStreamToVideo, onError])

  const handleTapToRefocus = useCallback(
    async (e: React.MouseEvent | React.TouchEvent) => {
      const video = videoRef.current
      const track = trackRef.current
      if (!video || !track) return
      const rect = video.getBoundingClientRect()
      const te = e as unknown as TouchEvent
      const touch = te.touches?.[0] ?? te.changedTouches?.[0]
      const x = touch ? touch.clientX : (e as React.MouseEvent).clientX
      const y = touch ? touch.clientY : (e as React.MouseEvent).clientY
      if (x == null || y == null) return
      const nx = (x - rect.left) / rect.width
      const ny = (y - rect.top) / rect.height
      const ok = await focusAtPoint(track, nx, ny)
      if (!ok && caps?.hasPointsOfInterest === false) {
        cleanup()
        setTimeout(() => void runScanner(), 150)
      }
    },
    [caps?.hasPointsOfInterest, cleanup, runScanner]
  )

  const handleTorchToggle = useCallback(async () => {
    const track = trackRef.current
    if (!caps?.hasTorch) return
    const next = !torchOn
    await setTorch(track, next)
    setTorchOn(next)
  }, [torchOn, caps?.hasTorch])

  const handleZoomChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value)
      setZoomVal(v)
      void setZoom(trackRef.current, v)
    },
    []
  )

  const handleDeviceSwitch = useCallback(() => {
    if (devices.length < 2) return
    const idx = devices.findIndex((d) => d.deviceId === currentDeviceId)
    const next = devices[(idx + 1) % devices.length]
    setCurrentDeviceId(next.deviceId)
  }, [devices, currentDeviceId])

  const handleTryFallback = useCallback(() => {
    cleanup()
    setUseFallback(true)
    setError(null)
  }, [cleanup])

  useEffect(() => {
    if (!active) {
      setUseFallback(false)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      if (!cancelled) void runScanner()
    }, 50)
    return () => {
      cancelled = true
      clearTimeout(t)
      cleanup()
    }
  }, [active, runScanner, cleanup])

  const fallbackScannerRef = useRef<{ stop: () => Promise<void> } | null>(null)
  useEffect(() => {
    if (!useFallback || !active) return
    let cancelled = false
    const elId = 'html5-qrcode-fallback'
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (cancelled || !document.getElementById(elId)) return
      const scanner = new Html5Qrcode(elId)
      fallbackScannerRef.current = scanner
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 8, qrbox: { width: 250, height: 150 } },
          (decoded) => {
            onDetectedRef.current(decoded)
            void scanner.stop()
          },
          () => {}
        )
        .catch((err: unknown) => !cancelled && setError(String(err)))
    })
    return () => {
      cancelled = true
      fallbackScannerRef.current?.stop().catch(() => {})
      fallbackScannerRef.current = null
    }
  }, [useFallback, active])

  if (!active) return null

  const containerClass = fullscreen
    ? 'fixed inset-0 z-[60] flex flex-col bg-black'
    : 'rounded-2xl bg-white p-4 shadow-sm'

  if (useFallback) {
    return (
      <div className={containerClass}>
        {fullscreen && onClose && (
          <button
            type="button"
            onClick={() => { setUseFallback(false); onClose?.() }}
            className="absolute top-4 right-4 z-10 rounded-full bg-black/50 p-2 text-white"
            aria-label="Close"
          >
            <X size={24} />
          </button>
        )}
        <div id="html5-qrcode-fallback" className="flex-1 min-h-[200px]" />
        {error && (
          <div className="absolute bottom-4 left-4 right-4 rounded-lg bg-red-600 px-4 py-2 text-sm text-white">
            {error}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={containerClass}>
      {fullscreen && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
          aria-label="Close"
        >
          <X size={24} />
        </button>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="relative flex-1 flex items-center justify-center overflow-hidden"
          onClick={handleTapToRefocus}
          onTouchEnd={(e) => e.changedTouches[0] && handleTapToRefocus(e)}
          role="button"
          tabIndex={0}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`w-full h-full object-contain bg-black ${!fullscreen ? 'min-h-[224px]' : ''}`}
          />
          <div className="absolute inset-0 pointer-events-none border-4 border-white/60 rounded-2xl m-4 flex items-center justify-center">
            <div className="w-64 h-40 border-2 border-white/80 rounded-lg" />
          </div>
          {error && (
            <div className="absolute bottom-2 left-2 right-2 rounded bg-red-600/90 px-3 py-2 text-sm text-white text-center">
              {error}
              <button
                type="button"
                className="mt-2 block w-full text-white/90 underline"
                onClick={(e) => { e.stopPropagation(); handleTryFallback() }}
              >
                Try alternative scanner
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 p-3 bg-black/80">
          {caps?.hasTorch && (
            <button
              type="button"
              onClick={handleTorchToggle}
              className={`rounded-full p-2 ${torchOn ? 'bg-amber-500 text-black' : 'bg-white/20 text-white'}`}
              aria-label="Torch"
            >
              <Zap size={22} />
            </button>
          )}
          {caps?.hasZoom && (
            <div className="flex-1 flex items-center gap-2">
              <span className="text-white text-sm w-8">1×</span>
              <input
                type="range"
                min={caps.zoomMin}
                max={caps.zoomMax}
                step={caps.zoomStep}
                value={zoomVal}
                onChange={handleZoomChange}
                className="flex-1 h-2 rounded-lg"
              />
              <span className="text-white text-sm w-10">{zoomVal.toFixed(1)}×</span>
            </div>
          )}
          {devices.length > 1 && (
            <button
              type="button"
              onClick={handleDeviceSwitch}
              className="rounded-full p-2 bg-white/20 text-white"
              aria-label="Switch camera"
            >
              <Camera size={22} />
            </button>
          )}
          {error && !caps && (
            <button
              type="button"
              onClick={handleTryFallback}
              className="rounded-lg px-3 py-2 bg-amber-600 text-white text-sm"
            >
              <RotateCcw size={18} className="inline mr-1" />
              Alternative
            </button>
          )}
        </div>
      </div>

      {scanErr && !error && (
        <div className="absolute bottom-20 left-4 right-4 rounded-lg bg-red-600 px-4 py-2 text-sm text-white">
          {scanErr}
        </div>
      )}
    </div>
  )
}
