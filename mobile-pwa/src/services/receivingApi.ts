import { fetchJSON } from './apiClient'

export type ReceiptStatus = 'draft' | 'completed' | 'cancelled'

export type ReceiptLine = {
  id: string
  product_id: string
  qty: number
  batch: string
  expiry_date?: string | null
  location_id: string
}

export type Receipt = {
  id: string
  doc_no: string
  status: ReceiptStatus
  created_by?: string | null
  created_by_username?: string | null
  created_at: string
  updated_at: string
  lines: ReceiptLine[]
}

export type ReceiptLineCreate = {
  product_id: string
  qty: number
  batch: string
  expiry_date?: string | null
  location_id: string
}

export type ReceiptCreateInput = {
  doc_no?: string
  lines: ReceiptLineCreate[]
  /** True bo'lsa backend qabulni atomik yaratadi va yakunlaydi (xatoda qoralama qolmaydi). */
  complete?: boolean
}

export type Receiver = {
  id: string
  name: string
}

export type ListReceiptsParams = {
  created_by?: string
  product_id?: string
  brand_id?: string
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}

export type ReceiptListResponse = {
  items: Receipt[]
  total: number
}

/** Soft cap for export payload (~10 MB estimated CSV/Excel size). */
export const MAX_EXPORT_BYTES = 10 * 1024 * 1024

const EXPORT_PAGE_LIMIT = 200

/** Rough UTF-8 size estimate for list export (CSV-like density). */
export function estimateReceiptListExportBytes(receipts: Receipt[]): number {
  let bytes = 900
  for (const receipt of receipts) {
    bytes += 100 + (receipt.doc_no?.length ?? 0) * 2
    bytes += (receipt.created_by_username?.length ?? 0) * 2
    for (const line of receipt.lines) {
      bytes += 420 + (line.batch?.length ?? 0) * 2
    }
  }
  return bytes
}

export class ReceiptExportTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReceiptExportTooLargeError'
  }
}

export async function getReceivers() {
  return fetchJSON<Receiver[]>('/api/v1/receiving/receipts/receivers')
}

export async function fetchAllReceipts(
  params: Omit<ListReceiptsParams, 'limit' | 'offset'> = {}
): Promise<Receipt[]> {
  const all: Receipt[] = []
  let offset = 0
  let total = Infinity

  while (offset < total) {
    const page = await listReceipts({
      ...params,
      limit: EXPORT_PAGE_LIMIT,
      offset,
    })
    total = page.total
    all.push(...page.items)
    if (page.items.length < EXPORT_PAGE_LIMIT) {
      break
    }
    offset += EXPORT_PAGE_LIMIT
  }

  if (estimateReceiptListExportBytes(all) > MAX_EXPORT_BYTES) {
    throw new ReceiptExportTooLargeError('MAX_SIZE')
  }

  return all
}

export async function listReceipts(
  params?: ListReceiptsParams
): Promise<ReceiptListResponse> {
  if (params == null) {
    return fetchJSON<ReceiptListResponse>('/api/v1/receiving/receipts', {})
  }
  const query: Record<string, string | number | undefined> = {
    created_by: params.created_by,
    product_id: params.product_id,
    brand_id: params.brand_id,
    date_from: params.date_from,
    date_to: params.date_to,
    limit: params.limit,
    offset: params.offset,
  }
  return fetchJSON<ReceiptListResponse>('/api/v1/receiving/receipts', {
    query: Object.fromEntries(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== '')
    ) as Record<string, string | number>,
  })
}

export async function createReceipt(payload: ReceiptCreateInput) {
  return fetchJSON<Receipt>('/api/v1/receiving/receipts', {
    method: 'POST',
    body: payload,
  })
}

export async function getReceipt(receiptId: string) {
  return fetchJSON<Receipt>(`/api/v1/receiving/receipts/${receiptId}`)
}

export async function completeReceipt(receiptId: string) {
  return fetchJSON<Receipt>(`/api/v1/receiving/receipts/${receiptId}/complete`, {
    method: 'POST',
  })
}

/** Qoralama (draft) qabulni o'chirish — qoldiqqa hech narsa yozilmagan bo'lsagina. */
export async function deleteReceipt(receiptId: string) {
  return fetchJSON<void>(`/api/v1/receiving/receipts/${receiptId}`, {
    method: 'DELETE',
  })
}
