/** Human-readable message from Error, API client throws, or other values. */
export function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    return err.message.trim() || err.name
  }
  if (typeof err === 'string') {
    return err
  }
  if (typeof err === 'object' && err !== null) {
    const o = err as Record<string, unknown>
    if (typeof o.message === 'string' && o.message.trim()) {
      return o.message
    }
    if (typeof o.detail === 'string' && o.detail.trim()) {
      return o.detail
    }
    if (Array.isArray(o.detail) && o.detail.length > 0) {
      const first = o.detail[0]
      if (typeof first === 'object' && first !== null && 'msg' in first) {
        return String((first as { msg: unknown }).msg)
      }
      return String(first)
    }
  }
  try {
    const s = JSON.stringify(err)
    if (s && s !== '{}') return s
  } catch {
    /* ignore */
  }
  return String(err)
}
