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

export async function listReceipts(status?: ReceiptStatus) {
  return fetchJSON<Receipt[]>('/api/v1/receiving/receipts', {
    query: { status },
  })
}

export async function createReceipt(payload: ReceiptCreateInput) {
  return fetchJSON<Receipt>('/api/v1/receiving/receipts', {
    method: 'POST',
    body: payload,
  })
}

export async function completeReceipt(receiptId: string) {
  return fetchJSON<Receipt>(`/api/v1/receiving/receipts/${receiptId}/complete`, {
    method: 'POST',
  })
}
