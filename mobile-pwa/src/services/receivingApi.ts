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
}

export type Receiver = {
  id: string
  name: string
}

export type ListReceiptsParams = {
  created_by?: string
  product_id?: string
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}

export type ReceiptListResponse = {
  items: Receipt[]
  total: number
}

export async function getReceivers() {
  return fetchJSON<Receiver[]>('/api/v1/receiving/receipts/receivers')
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
