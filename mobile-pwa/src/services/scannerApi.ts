import { fetchJSON } from './apiClient'

export type ScannerResolveResult = {
  type: 'PRODUCT' | 'LOCATION' | 'UNKNOWN'
  entity_id: string | null
  display_label: string | null
}

export async function resolveBarcode(barcode: string): Promise<ScannerResolveResult> {
  return fetchJSON<ScannerResolveResult>('/api/v1/scanner/resolve', {
    method: 'POST',
    body: { barcode: barcode.trim() },
  })
}
