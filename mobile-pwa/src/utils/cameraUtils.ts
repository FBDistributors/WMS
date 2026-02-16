/**
 * Camera stream utilities for barcode scanner.
 * Full control: getUserMedia constraints, device selection, torch, zoom, focus.
 */

export interface CameraDevice {
  deviceId: string
  label: string
  kind: MediaDeviceInfo['kind']
}

const DEFAULT_ZOOM = 1.5

function label(d: MediaDeviceInfo) {
  return (d.label || '').toLowerCase()
}

function isFront(d: MediaDeviceInfo) {
  return /front|selfie|user|facing/i.test(label(d))
}

function isBack(d: MediaDeviceInfo) {
  return /back|rear|environment|asosiy|orqa/i.test(label(d))
}

/** Exclude ultra-wide, macro, 0.5x; prefer main back camera */
function isUltraWide(d: MediaDeviceInfo) {
  return /ultra|wide|0\.5|macro|fisheye/i.test(label(d))
}

/** Get preferred back camera deviceId (main, non-ultrawide) */
export async function getPreferredBackCameraDeviceId(): Promise<string | undefined> {
  const list = await listBackCameras()
  return list[0]?.deviceId
}

/** List back cameras by label heuristics, prefer main over ultrawide */
export async function listBackCameras(): Promise<CameraDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const videoInputs = devices.filter((d) => d.kind === 'videoinput')
  const back = videoInputs.filter((d) => isBack(d) && !isFront(d))
  const candidates = back.length ? back : videoInputs.filter((d) => !isFront(d))
  const main = candidates.filter((d) => !isUltraWide(d) || candidates.length === 1)
  const list = main.length ? main : candidates
  return list.map((d) => ({
    deviceId: d.deviceId,
    label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
    kind: d.kind,
  }))
}

/** Build constraints: 1920x1080 or 1280x720, facingMode env, frameRate 30, focusMode continuous */
export function buildVideoConstraints(deviceId?: string, prefer1080 = true): MediaTrackConstraints {
  const w = prefer1080 ? 1920 : 1280
  const h = prefer1080 ? 1080 : 720
  const base: Record<string, unknown> = {
    facingMode: { exact: 'environment' },
    width: { ideal: w, min: 1280 },
    height: { ideal: h, min: 720 },
    frameRate: { ideal: 30 },
  }
  const supported = navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean>
  if (supported.focusMode) {
    base.focusMode = 'continuous'
  }
  if (deviceId) {
    base.deviceId = { exact: deviceId }
  }
  return base as MediaTrackConstraints
}

/** Start stream with our constraints. Never 640x480. */
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
  if (track) {
    setTimeout(() => focusAtPoint(track, 0.5, 0.5), 300)
  }
  return stream
}

/** Stop all tracks; prevent leaks */
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
  focusModes?: string[]
}

export interface TrackSettingsInfo {
  width?: number
  height?: number
  frameRate?: number
  zoom?: number
}

/** Extract width, height, frameRate, zoom from track.getSettings() for debug */
export function getTrackSettings(track: MediaStreamTrack | null): TrackSettingsInfo {
  if (!track?.getSettings) return {}
  const s = track.getSettings() as Record<string, unknown>
  return {
    width: typeof s.width === 'number' ? s.width : undefined,
    height: typeof s.height === 'number' ? s.height : undefined,
    frameRate: typeof s.frameRate === 'number' ? s.frameRate : undefined,
    zoom: typeof s.zoom === 'number' ? s.zoom : undefined,
  }
}

/** Detect torch, zoom, tap-to-focus from track */
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
  if (Array.isArray(c.focusMode)) {
    caps.focusModes = c.focusMode as string[]
  } else if (typeof c.focusMode === 'object' && c.focusMode !== null && 'ideal' in (c.focusMode as object)) {
    const fm = (c.focusMode as { ideal?: string | string[] }).ideal
    caps.focusModes = Array.isArray(fm) ? fm : fm ? [fm] : []
  }
  return caps
}

/** AppSheet-like default zoom: 1.5x if supported */
export function getDefaultZoom(caps: TrackCapabilities | null): number {
  if (!caps?.hasZoom || caps.zoomMax < 1.5) return 1
  return Math.min(caps.zoomMax, DEFAULT_ZOOM)
}

/** Apply zoom (1 = no zoom) */
export async function applyZoom(stream: MediaStream | null, value: number): Promise<void> {
  const track = stream?.getVideoTracks()[0] ?? null
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

/** Toggle torch on/off */
export async function toggleTorch(stream: MediaStream | null, on: boolean): Promise<void> {
  const track = stream?.getVideoTracks()[0] ?? null
  if (!track) return
  const c = track.getCapabilities?.() as Record<string, unknown> | undefined
  if (!c?.torch) return
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] } as unknown as MediaTrackConstraints)
  } catch {
    // iOS/Safari often doesn't support torch
  }
}

/** Set torch by track (convenience) */
export async function setTorch(track: MediaStreamTrack | null, on: boolean): Promise<void> {
  const stream = track ? { getVideoTracks: () => [track] } as MediaStream : null
  await toggleTorch(stream, on)
}

/** Tap-to-refocus at normalized point. Returns true if applied. */
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

/** Set zoom by track (convenience) */
export async function setZoom(track: MediaStreamTrack | null, value: number): Promise<void> {
  const stream = track ? { getVideoTracks: () => [track] } as MediaStream : null
  await applyZoom(stream, value)
}
