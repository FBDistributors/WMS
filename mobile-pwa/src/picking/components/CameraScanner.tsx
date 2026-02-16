import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Zap, RotateCcw, Focus, ScanLine, Camera } from 'lucide-react'
import type { Result } from '@zxing/library'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import type { IScannerControls } from '@zxing/browser'
import { isNativePlatform, scanOnce } from '../../services/scanner'
import { playBeep, vibrateSuccess } from '../../utils/beep'
import {
  getPreferredBackCameraDeviceId,
  getPersistedDeviceId,
  setPersistedDeviceId,
  listBackCameras,
  buildVideoConstraints,
  startStream,
  stopStream,
  getTrackCapabilities,
  getTrackSettings,
  getDefaultZoom,
  applyZoom,
  setTorch,
  focusAtPoint,
  triggerSingleShotFocus,
  type CameraDevice,
  type TrackCapabilities,
  type TrackSettingsInfo,
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

const DECODE_HINTS = new Map<number, unknown>([
  [DecodeHintType.TRY_HARDER, true],
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128]],
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
  const [trackSettings, setTrackSettings] = useState<TrackSettingsInfo>({})
  const [currentDeviceLabel, setCurrentDeviceLabel] = useState<string>('')
  const [useFallback, setUseFallback] = useState(false)
  const [showDebug, setShowDebug] = useState(true)
  const fallbackDeviceIdRef = useRef<string | undefined>(undefined)
  const actualDeviceIdRef = useRef<string | undefined>(undefined)
  const lastCodeRef = useRef<string>('')
  const lastCodeTimeRef = useRef(0)
  const [useWebScanner, setUseWebScanner] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const isNative = isNativePlatform()

  const reportCode = useCallback(
    (code: string) => {
      const now = Date.now()
      if (code === lastCodeRef.current && now - lastCodeTimeRef.current < 800) return
      lastCodeRef.current = code
      lastCodeTimeRef.current = now
      playBeep()
      vibrateSuccess()
      onDetectedRef.current(code)
    },
    []
  )

  const handleNativeScan = useCallback(async () => {
    if (isScanning) return
    setIsScanning(true)
    setError(null)
    try {
      const result = await scanOnce()
      if (result?.code) reportCode(result.code)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      onError?.(msg)
    } finally {
      setIsScanning(false)
    }
  }, [isScanning, onError])

  const handleManualSubmit = useCallback(() => {
    const code = manualInput.trim()
    if (!code) return
    setManualInput('')
    reportCode(code)
  }, [manualInput, reportCode])

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
          ctrl.stop()
          stopStream(streamRef.current)
          streamRef.current = null
          trackRef.current = null
          onDetectedRef.current(text)
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
      const preferred = currentDeviceId ?? getPersistedDeviceId() ?? (await getPreferredBackCameraDeviceId()) ?? deviceList[0]?.deviceId
      const deviceId = deviceList.some((d) => d.deviceId === preferred) ? preferred : deviceList[0]?.deviceId
      actualDeviceIdRef.current = deviceId
      if (deviceId) setPersistedDeviceId(deviceId)
      const selectedDevice = deviceList.find((d) => d.deviceId === deviceId) ?? deviceList[0]
      setCurrentDeviceLabel(selectedDevice?.label ?? deviceId ?? '')
      fallbackDeviceIdRef.current = deviceId

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
      await applyZoom(stream, initialZoom)

      await attachStreamToVideo(stream, video)
      await new Promise((r) => setTimeout(r, 300))
      setTrackSettings(getTrackSettings(track ?? null))
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

  /** Tap-to-focus: try pointsOfInterest, then single-shot, then full stream restart */
  const handleTapToRefocus = useCallback(
    async (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault()
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
      let ok = await focusAtPoint(track, nx, ny)
      if (!ok) ok = await triggerSingleShotFocus(track)
      if (!ok) {
        cleanup()
        setTimeout(() => void runScanner(), 150)
      }
    },
    [cleanup, runScanner]
  )

  const handleRefocusClick = useCallback(async () => {
    const track = trackRef.current
    if (!track) return
    let ok = await focusAtPoint(track, 0.5, 0.5)
    if (!ok) ok = await triggerSingleShotFocus(track)
    if (!ok) {
      cleanup()
      setTimeout(() => void runScanner(), 150)
    }
  }, [cleanup, runScanner])

  const handleTorchToggle = useCallback(async () => {
    const track = trackRef.current
    if (!caps?.hasTorch) return
    const next = !torchOn
    await setTorch(track, next)
    setTorchOn(next)
  }, [torchOn, caps?.hasTorch])

  const handleZoomChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value)
      setZoomVal(v)
      await applyZoom(streamRef.current, v)
      setTrackSettings(getTrackSettings(trackRef.current))
    },
    []
  )

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
  }, [active, currentDeviceId, runScanner, cleanup])

  const fallbackScannerRef = useRef<{ stop: () => Promise<void> } | null>(null)
  useEffect(() => {
    if (!useFallback || !active) return
    let cancelled = false
    const elId = 'html5-qrcode-fallback'
    const deviceId = fallbackDeviceIdRef.current
    import('html5-qrcode').then(({ Html5Qrcode, Html5QrcodeSupportedFormats }) => {
      if (cancelled || !document.getElementById(elId)) return
      const scanner = new Html5Qrcode(elId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
        ],
      })
      fallbackScannerRef.current = scanner
      const cameraConfig: MediaTrackConstraints = deviceId
        ? {
            deviceId: { exact: deviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          }
        : {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          }
      const scanConfig = {
        fps: 15,
        disableFlip: true,
        qrbox: { width: 280, height: 120 },
      }
      scanner
        .start(cameraConfig, scanConfig, (decoded) => {
          onDetectedRef.current(decoded)
          void scanner.stop()
        }, () => {})
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

  if (isNative && !useWebScanner) {
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
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
          <button
            type="button"
            onClick={handleNativeScan}
            disabled={isScanning}
            className="flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-full bg-blue-600 text-white shadow-lg transition active:scale-95 disabled:opacity-70"
            aria-label="Scan barcode"
          >
            <ScanLine size={64} strokeWidth={2} />
            <span className="text-lg font-medium">{isScanning ? '...' : 'Scan'}</span>
          </button>
          <div className="w-full max-w-xs space-y-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              placeholder="Or paste barcode"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
            <button
              type="button"
              onClick={handleManualSubmit}
              disabled={!manualInput.trim()}
              className="w-full rounded-lg bg-slate-200 px-4 py-3 font-medium disabled:opacity-50 dark:bg-slate-700 dark:text-white"
            >
              Enter manually
            </button>
          </div>
          <button
            type="button"
            onClick={() => setUseWebScanner(true)}
            className="flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-sm text-white"
          >
            <Camera size={18} />
            Use web scanner
          </button>
          {error && (
            <div className="rounded-lg bg-red-600/90 px-4 py-2 text-sm text-white">{error}</div>
          )}
          {scanErr && !error && (
            <div className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white">{scanErr}</div>
          )}
        </div>
      </div>
    )
  }

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
          className="relative flex-1 flex items-center justify-center overflow-hidden bg-black"
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
            className={`w-full h-full object-cover ${!fullscreen ? 'min-h-[224px]' : ''}`}
            style={{ imageRendering: 'auto' }}
          />
          <div className="absolute inset-0 pointer-events-none border-4 border-white/60 rounded-2xl m-4 flex items-center justify-center">
            <div className="w-64 h-40 border-2 border-white/80 rounded-lg" />
          </div>
          {showDebug && (
            <div
              className="absolute top-2 left-2 right-2 max-w-[90%] rounded bg-black/70 px-2 py-1.5 text-[10px] text-green-400 font-mono pointer-events-auto"
              role="button"
              onClick={() => setShowDebug(false)}
              onKeyDown={(e) => e.key === 'Enter' && setShowDebug(false)}
              tabIndex={0}
            >
              <div title={currentDeviceId}>📷 {currentDeviceLabel || '—'}</div>
              <div>ID: {(currentDeviceId || '').slice(0, 20)}…</div>
              <div>
                Settings: {trackSettings.width ?? '?'}×{trackSettings.height ?? '?'} @{' '}
                {trackSettings.frameRate ?? '?'}fps
                {trackSettings.zoom != null ? ` zoom=${trackSettings.zoom.toFixed(1)}` : ''}
              </div>
              <div>
                Caps: zoom{caps?.hasZoom ? ` ${caps.zoomMin}–${caps.zoomMax}` : '✗'} torch
                {caps?.hasTorch ? ' ✓' : ' ✗'} focus{caps?.focusModes?.length ? ` ${caps.focusModes.join(',')}` : ' ✗'} exposure
                {caps?.exposureModes?.length ? ` ${caps.exposureModes.join(',')}` : ' ✗'}
              </div>
              <div className="text-white/60">tap to hide</div>
            </div>
          )}
          {!showDebug && (
            <button
              type="button"
              className="absolute top-2 left-2 rounded bg-black/50 px-2 py-1 text-[10px] text-white/70 pointer-events-auto"
              onClick={() => setShowDebug(true)}
            >
              Debug
            </button>
          )}
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
          <button
            type="button"
            onClick={handleRefocusClick}
            className="rounded-full p-2 bg-white/20 text-white"
            aria-label="Refocus"
          >
            <Focus size={22} />
          </button>
          {devices.length > 1 && (
            <select
              value={currentDeviceId ?? actualDeviceIdRef.current ?? ''}
              onChange={(e) => {
                const id = e.target.value
                if (id) {
                  setCurrentDeviceId(id)
                  setPersistedDeviceId(id)
                }
              }}
              className="max-w-[140px] rounded-lg bg-white/20 px-2 py-1.5 text-sm text-white border border-white/30"
              aria-label="Switch camera"
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId} className="text-black">
                  {d.label}
                </option>
              ))}
            </select>
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
          {isNative && (
            <button
              type="button"
              onClick={() => setUseWebScanner(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 bg-blue-600 text-white text-sm"
            >
              <ScanLine size={18} />
              Native scan
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
