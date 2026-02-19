import { useCallback, useState } from 'react';
import { getInventoryByBarcode } from '../api/inventory';
import type { InventoryByBarcodeResponse } from '../api/inventory';

type Status = 'idle' | 'loading' | 'success' | 'error';

export function useProductByBarcode() {
  const [product, setProduct] = useState<InventoryByBarcodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  const fetchByBarcode = useCallback(async (barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;
    setStatus('loading');
    setError(null);
    setProduct(null);
    try {
      const data = await getInventoryByBarcode(trimmed);
      setProduct(data);
      setStatus('success');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setError(message);
      setStatus('error');
      setProduct(null);
    }
  }, []);

  const reset = useCallback(() => {
    setProduct(null);
    setError(null);
    setStatus('idle');
  }, []);

  return { product, error, status, fetchByBarcode, reset };
}
