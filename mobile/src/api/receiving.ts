/**
 * Receiving (Qabul/Kirim) API — backend /api/v1/receiving ga mos.
 * Mobil Kirim orqali qabul yaratish va yakunlash (ombor qoldig'ini yangilash).
 */
import apiClient from './client';

export type ReceiptLineCreate = {
  product_id: string;
  qty: number;
  batch: string;
  expiry_date?: string | null;
  location_id: string;
};

export type ReceiptCreateInput = {
  doc_no?: string;
  lines: ReceiptLineCreate[];
};

export type Receipt = {
  id: string;
  doc_no: string;
  status: string;
  created_at: string;
  updated_at: string;
  lines: Array<{
    id: string;
    product_id: string;
    qty: number;
    batch: string;
    expiry_date?: string | null;
    location_id: string;
  }>;
};

export async function createReceipt(payload: ReceiptCreateInput): Promise<Receipt> {
  const { data } = await apiClient.post<Receipt>('/receiving/receipts', payload);
  return data;
}

export async function completeReceipt(receiptId: string): Promise<Receipt> {
  const { data } = await apiClient.post<Receipt>(`/receiving/receipts/${receiptId}/complete`);
  return data;
}
