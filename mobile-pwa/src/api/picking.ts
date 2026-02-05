export type PickingLine = {
  id: string
  product_name: string
  sku?: string
  barcode?: string
  location_code: string
  qty_required: number
  qty_picked: number
}

export type PickingProgress = {
  picked: number
  required: number
}

export type PickingDocument = {
  id: string
  reference_number: string
  status: string
  lines: PickingLine[]
  progress: PickingProgress
}

export type ApiError = {
  message: string
  status?: number
  code?: 'TIMEOUT' | 'NETWORK' | 'HTTP'
  details?: unknown
}

type RequestOptions<TBody> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: TBody
  headers?: Record<string, string>
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15000
const rawBaseUrl =
  import.meta.env.VITE_API_BASE_URL ?? 'https://wms-ngdm.onrender.com'
const baseUrl = rawBaseUrl.toString().replace(/\/+$/, '')

function buildUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return new URL(normalizedPath, `${baseUrl}/`).toString()
}

// API helper with timeout + JSON error handling.
async function fetchJSON<TResponse, TBody = unknown>(
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
      } satisfies ApiError
    }

    return payload as TResponse
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw {
        message: 'Request timeout',
        code: 'TIMEOUT',
      } satisfies ApiError
    }

    if (typeof error === 'object' && error !== null && 'code' in error) {
      throw error as ApiError
    }

    throw {
      message: 'Network error',
      code: 'NETWORK',
      details: error,
    } satisfies ApiError
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function getPickingDocument(documentId: string) {
  return fetchJSON<PickingDocument>(`/api/v1/picking/documents/${documentId}`)
}

export async function pickLine(
  lineId: string,
  delta: 1 | -1,
  requestId: string
) {
  return fetchJSON<{ line: PickingLine; progress: PickingProgress; document_status: string }>(
    `/api/v1/picking/lines/${lineId}/pick`,
    {
      method: 'POST',
      body: {
        delta,
        request_id: requestId,
      },
    }
  )
}

export async function completePickingDocument(documentId: string) {
  return fetchJSON<PickingDocument>(`/api/v1/picking/documents/${documentId}/complete`, {
    method: 'POST',
  })
}
