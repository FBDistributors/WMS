type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type HttpError = {
  message: string
  status?: number
  code?: 'TIMEOUT' | 'NETWORK' | 'HTTP'
  details?: unknown
}

type RequestOptions<TBody> = {
  method?: HttpMethod
  body?: TBody
  headers?: Record<string, string>
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15000

const baseURL = (import.meta.env.VITE_API_URL ?? 'https://wms-ngdm.onrender.com')
  .toString()
  .replace(/\/+$/, '')

function buildUrl(path: string) {
  if (!baseURL) {
    throw {
      message: 'Missing VITE_API_URL',
      code: 'NETWORK',
    } satisfies HttpError
  }
  return `${baseURL}${path.startsWith('/') ? path : `/${path}`}`
}

export async function requestJson<TResponse, TBody = unknown>(
  path: string,
  options: RequestOptions<TBody> = {}
): Promise<TResponse> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(buildUrl(path), {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })

    const contentType = response.headers.get('Content-Type') ?? ''
    const isJson = contentType.includes('application/json')
    const payload = isJson ? await response.json() : await response.text()

    if (!response.ok) {
      throw {
        message: `HTTP ${response.status}`,
        status: response.status,
        code: 'HTTP',
        details: payload,
      } satisfies HttpError
    }

    return payload as TResponse
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw {
        message: 'Request timeout',
        code: 'TIMEOUT',
      } satisfies HttpError
    }

    if (typeof error === 'object' && error !== null && 'code' in error) {
      throw error as HttpError
    }

    throw {
      message: 'Network error',
      code: 'NETWORK',
      details: error,
    } satisfies HttpError
  } finally {
    clearTimeout(timeoutId)
  }
}
