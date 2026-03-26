/**
 * Barcode resolve — mahsulot yoki lokatsiya (palet kodi).
 */
import apiClient from './client';

export type ScannerResolveOut = {
  type: 'PRODUCT' | 'LOCATION' | 'UNKNOWN';
  product: { id: string; name: string; barcode: string | null } | null;
  location: { id: string; code: string } | null;
  entity_id: string | null;
  display_label: string | null;
  message: string | null;
};

export async function resolveScannerBarcode(barcode: string): Promise<ScannerResolveOut> {
  const { data } = await apiClient.post<ScannerResolveOut>('/scanner/resolve', {
    barcode: barcode.trim(),
  });
  return data;
}
