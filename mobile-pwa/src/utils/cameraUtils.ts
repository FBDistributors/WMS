/**
 * Camera stream utilities for barcode scanner.
 * Handles device selection, constraints, capabilities detection.
 */

export interface CameraDevice {
  deviceId: string
  label: string
  kind: MediaDeviceInfo['kind']
}

const DEFAULT_ZOOM = 1.5

/** High-res: prefer 1920x1080, fallback 1280x720. Never 640x480. */
function getVideoConstraints(prefer1080 = true): MediaTrackConstraints {
  const w = prefer1080 ? 1920 : 1280
  const h = prefer1080 ? 1080 : 720
  return {
    facingMode: { exact: 'environment' },
    width: { ideal: w, min: 1280 },
    height: { ideal: h, min: 720 },
  }
}

function label(d: MediaDeviceInfo) {
  return (d.label || '').toLowerCase()
}

function isFront(d: MediaDeviceInfo) {
  return /front|selfie|user|facing/i.test(label(d))
}

function isBack(d: MediaDeviceInfo) {
  return /back|rear|environment|asosiy|orqa/i.test(label(d))
}

function isUltraWide(d: MediaDeviceInfo) {
  return /ultra|0\.5x|macro|fisheye/i.test(label(d))
}

/** List back cameras, preferring main (non–ultra-wide) */
export async function listBackCameras(): Promise<CameraDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const videoInputs = devices.filter((d) => d.kind === 'videoinput')
  const back = videoInputs.filter((d) => isBack(d) && !isFront(d))
  const candidates = back.length ? back : videoInputs.filter((d) => !isFront(d))
  const main = candidates.filter((d) => !isUltraWide(d) || candidates.length === 1)
  const list = main.length ? main : candidates
  return list.map((d) => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 8)}`, kind: d.kind }))
}

/** Build video constraints for a device (or default back). Prefer 1080p, fallback 720p. */
export function buildVideoConstraints(deviceId?: string, prefer1080 = true): MediaTrackConstraints {
  const base = { ...getVideoConstraints(prefer1080) }
  const supported = navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean>
  if (supported.focusMode) {
    ;(base as Record<string, unknown>).focusMode = 'continuous'
  }
  if (deviceId) {
    ;(base as Record<string, unknown>).deviceId = { exact: deviceId }
  }
  return base
}

/** Start camera stream with given constraints */
export async function startStream(constraints: MediaTrackConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera not supported. Use HTTPS and a compatible browser.')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: constraints })
  const track = stream.getVideoTracks()[0]
  const supported = navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean>
  if (track && supported.focusMode) {
    try {
      await track.applyConstraints({ focusMode: 'continuous' } as MediaTrackConstraints)
    } catch {
      // ignore
    }
  }
  // Markazga dastlabki fokus — barcode odatda o‘rta qismda
  if (track) {
    setTimeout(() => focusAtPoint(track, 0.5, 0.5), 300)
  }
  return stream
}

/** Stop all tracks in stream */
export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop())
}

export interface TrackCapabilities {
  hasTorch: boolean
  hasZoom: boolean
  zoomMin: number
  zoomMax: number
  zoomStep: number
  hasPointsOfInterest: boolean
}

/** Detect track capabilities for torch, zoom, tap-to-focus */
export function getTrackCapabilities(track: MediaStreamTrack | null): TrackCapabilities {
  const caps: TrackCapabilities = {
    hasTorch: false,
    hasZoom: false,
    zoomMin: 1,
    zoomMax: 1,
    zoomStep: 0.1,
    hasPointsOfInterest: false,
  }
  if (!track?.getCapabilities) return caps
  const c = track.getCapabilities() as Record<string, unknown>
  caps.hasTorch = typeof c.torch === 'boolean' ? c.torch : false
  if (typeof c.zoom === 'object' && c.zoom !== null && 'min' in (c.zoom as object)) {
    const z = c.zoom as { min: number; max: number; step?: number }
    caps.hasZoom = true
    caps.zoomMin = z.min ?? 1
    caps.zoomMax = z.max ?? 1
    caps.zoomStep = z.step ?? 0.1
  }
  caps.hasPointsOfInterest = 'pointsOfInterest' in c
  return caps
}

/** Toggle torch on/off */
export async function setTorch(track: MediaStreamTrack | null, on: boolean): Promise<void> {
  if (!track) return
  const c = track.getCapabilities?.() as Record<string, unknown> | undefined
  if (!c?.torch) return
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] } as unknown as MediaTrackConstraints)
  } catch {
    // iOS/Safari often doesn't support torch
  }
}

/** AppSheet-like default zoom: 1.5x if supported (sharper 1D barcodes) */
export function getDefaultZoom(caps: TrackCapabilities | null): number {
  if (!caps?.hasZoom || caps.zoomMax < 1.5) return 1
  return Math.min(caps.zoomMax, DEFAULT_ZOOM)
}

/** Set zoom level (1 = no zoom) */
export async function setZoom(track: MediaStreamTrack | null, value: number): Promise<void> {
  if (!track) return
  const c = track.getCapabilities?.() as { zoom?: { min: number; max: number } } | undefined
  if (!c?.zoom) return
  const clamped = Math.max(c.zoom.min, Math.min(c.zoom.max, value))
  try {
    await track.applyConstraints({ advanced: [{ zoom: clamped }] } as unknown as MediaTrackConstraints)
  } catch {
    // ignore
  }
}

/** Tap to refocus at normalized point (0–1). Returns true if applied, false if not supported. */
export async function focusAtPoint(track: MediaStreamTrack | null, x: number, y: number): Promise<boolean> {
  if (!track) return false
  const c = track.getCapabilities?.() as Record<string, unknown> | undefined
  if (!c?.pointsOfInterest) return false
  const nx = Math.max(0, Math.min(1, x))
  const ny = Math.max(0, Math.min(1, y))
  try {
    await track.applyConstraints({ pointsOfInterest: [{ x: nx, y: ny }] } as unknown as MediaTrackConstraints)
    return true
  } catch {
    return false
  }
}
