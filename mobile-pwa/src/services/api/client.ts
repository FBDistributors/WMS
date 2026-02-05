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
}

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

export async function fetchJSON<TResponse, TBody = unknown>(
  path: string,
  options: RequestOptions<TBody> = {}
): Promise<TResponse> {
  try {
    const url = buildApiUrl(path, options.query)
    if (import.meta.env.DEV && path.startsWith('/api/v1/documents')) {
      console.debug('Documents API URL:', url)
    }
    const response = await fetch(url, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
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
      } satisfies ApiError
    }

    return payload as TResponse
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      throw error as ApiError
    }

    throw {
      message: 'Network error',
      code: 'NETWORK',
      details: error,
    } satisfies ApiError
  }
}

export type { ApiError }
