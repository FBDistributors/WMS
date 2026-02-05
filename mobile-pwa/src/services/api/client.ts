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
}

const rawBaseUrl = import.meta.env.VITE_API_URL ?? 'https://wms-ngdm.onrender.com'
const baseUrl = rawBaseUrl.toString().replace(/\/+$/, '')

function buildUrl(path: string) {
  const normalizedPath = path.replace(/\/\?/, '?')
  return `${baseUrl}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`
}

export async function fetchJSON<TResponse, TBody = unknown>(
  path: string,
  options: RequestOptions<TBody> = {}
): Promise<TResponse> {
  try {
    const response = await fetch(buildUrl(path), {
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
