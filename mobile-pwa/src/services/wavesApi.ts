import { fetchJSON } from './apiClient'

export type WaveOrderOut = {
  id: string
  order_id: string
  order_number: string
  source_external_id: string
}

export type WaveLineAllocationOut = {
  lot_id: string
  location_id: string
  location_code: string
  batch: string
  expiry_date: string | null
  allocated_qty: number
  picked_qty: number
}

export type WaveLineOut = {
  id: string
  product_id: string
  barcode: string
  total_qty: number
  picked_qty: number
  status: string
  product_name?: string | null
  product_sku?: string | null
  brand?: string | null
  allocations?: WaveLineAllocationOut[] | null
}

export type SortingBinOut = {
  id: string
  order_id: string
  bin_code: string
  status: string
}

export type WaveOut = {
  id: string
  wave_number: string
  status: string
  created_by: string | null
  note: string | null
  created_at: string
  updated_at: string
  orders: WaveOrderOut[]
  lines: WaveLineOut[]
  bins: SortingBinOut[] | null
}

export type WaveListResponse = {
  items: WaveOut[]
  total: number
  limit: number
  offset: number
}

export type WaveCreateIn = {
  order_ids: string[]
  note?: string | null
}

export type PickScanIn = {
  barcode: string
  qty: number
  request_id: string
}

export type SortingScanIn = {
  order_id: string
  barcode: string
  qty: number
  request_id: string
}

export type WavesQuery = {
  status?: string
  limit?: number
  offset?: number
}

export async function getWaves(query: WavesQuery = {}) {
  return fetchJSON<WaveListResponse>('/api/v1/waves', { query })
}

export async function getWave(id: string) {
  return fetchJSON<WaveOut>(`/api/v1/waves/${id}`)
}

export async function createWave(payload: WaveCreateIn) {
  return fetchJSON<WaveOut>('/api/v1/waves', {
    method: 'POST',
    body: payload,
  })
}

export async function startWave(id: string) {
  return fetchJSON<WaveOut>(`/api/v1/waves/${id}/start`, {
    method: 'POST',
  })
}

export async function pickScan(waveId: string, payload: PickScanIn) {
  return fetchJSON<{ status: string; idempotent?: boolean; remaining?: number; wave_status?: string }>(
    `/api/v1/waves/${waveId}/pick/scan`,
    {
      method: 'POST',
      body: payload,
    }
  )
}

export async function sortingScan(waveId: string, payload: SortingScanIn) {
  return fetchJSON<{ status: string; idempotent?: boolean }>(
    `/api/v1/waves/${waveId}/sorting/scan`,
    {
      method: 'POST',
      body: payload,
    }
  )
}

export async function completeWave(id: string) {
  return fetchJSON<WaveOut>(`/api/v1/waves/${id}/complete`, {
    method: 'POST',
  })
}
