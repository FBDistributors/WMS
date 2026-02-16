type ApiError = {
  message: string
  status?: number
  code?: 'NETWORK' | 'HTTP'
  details?: unknown
}

type RequestOptions<TBody> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: TBody
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | undefined>
  signal?: AbortSignal
}

const TOKEN_KEY = 'wms_token'
const FETCH_TIMEOUT_MS = 30000
const rawBaseUrl =
  import.meta.env.VITE_API_BASE_URL ?? 'https://wms-ngdm.onrender.com'
const baseUrl = rawBaseUrl.toString().replace(/\/+$/, '')

export function buildApiUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined>
) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = new URL(normalizedPath, `${baseUrl}/`)
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    })
  }
  return url.toString()
}

function clearTokenAndRedirect() {
  localStorage.removeItem(TOKEN_KEY)
  if (window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

export async function fetchJSON<TResponse, TBody = unknown>(
  path: string,
  options: RequestOptions<TBody> = {}
): Promise<TResponse> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const controller = options.signal ? null : new AbortController()
  if (controller) {
    timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  }
  const signal = options.signal ?? controller!.signal

  try {
    const url = buildApiUrl(path, options.query)
    const token = localStorage.getItem(TOKEN_KEY)
    const response = await fetch(url, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal,
    })
    if (timeoutId) clearTimeout(timeoutId)

    const contentType = response.headers.get('Content-Type') ?? ''
    const isJson = contentType.includes('application/json')
    const payload = isJson ? await response.json() : await response.text()

    if (response.status === 401 && path !== '/api/v1/auth/login') {
      // Check if it's a session expired error
      const errorDetail = isJson && payload && typeof payload === 'object' && 'detail' in payload 
        ? String(payload.detail) 
        : ''
      
      if (errorDetail.includes('logged in from another device')) {
        // Store session expired flag for user-friendly message
        sessionStorage.setItem('session_expired_reason', 'another_device')
      }
      
      clearTokenAndRedirect()
    }

    if (!response.ok) {
      let message = `HTTP ${response.status}`
      if (isJson && payload && typeof payload === 'object' && payload !== null) {
        const d = (payload as { detail?: string | { msg?: string }[] }).detail
        if (typeof d === 'string') message = d
        else if (Array.isArray(d) && d[0] && typeof d[0] === 'object' && 'msg' in d[0])
          message = String((d[0] as { msg: string }).msg)
      }
      throw {
        message,
        status: response.status,
        code: 'HTTP',
        details: payload,
      } satisfies ApiError
    }

    return payload as TResponse
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId)
    if (typeof error === 'object' && error !== null && 'code' in error) {
      throw error as ApiError
    }
    const originalMsg =
      error instanceof Error ? error.message : typeof error === 'string' ? error : ''
    const isAbort = originalMsg === 'AbortError' || (error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError')
    throw {
      message: isAbort ? 'Request timeout' : (originalMsg || 'Network error'),
      code: 'NETWORK',
      details: error,
    } satisfies ApiError
  }
}

export type { ApiError }
