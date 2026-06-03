import { formatUnknownError } from './formatUnknownError'

const RELOAD_SESSION_KEY = 'wms_chunk_reload_attempt'

export function isStaleChunkLoadError(err: unknown): boolean {
  const msg = formatUnknownError(err).toLowerCase()
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('failed to fetch module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk')
  )
}

/** Reload once after deploy/cache mismatch; returns true if reload was triggered. */
export function reloadOnceOnStaleChunk(err: unknown): boolean {
  if (!isStaleChunkLoadError(err)) return false
  try {
    if (sessionStorage.getItem(RELOAD_SESSION_KEY)) {
      sessionStorage.removeItem(RELOAD_SESSION_KEY)
      return false
    }
    sessionStorage.setItem(RELOAD_SESSION_KEY, '1')
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export class StaleAppChunkError extends Error {
  constructor() {
    super('stale_app_chunk')
    this.name = 'StaleAppChunkError'
  }
}
