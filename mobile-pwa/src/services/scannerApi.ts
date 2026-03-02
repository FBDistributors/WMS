import { fetchJSON } from './apiClient'

export type ProductResolve = {
  id: string
  name: string
  barcode: string | null
  brand?: string | null
  uom?: string | null
}

export type LocationResolve = {
  id: string
  code: string
}

export type ScannerResolveResult = {
  type: 'PRODUCT' | 'LOCATION' | 'UNKNOWN'
  product?: ProductResolve | null
  location?: LocationResolve | null
  entity_id?: string | null
  display_label?: string | null
  message?: string | null
}

export async function resolveBarcode(barcode: string): Promise<ScannerResolveResult> {
  return fetchJSON<ScannerResolveResult>('/api/v1/scanner/resolve', {
    method: 'POST',
    body: { barcode: barcode.trim() },
  })
}
