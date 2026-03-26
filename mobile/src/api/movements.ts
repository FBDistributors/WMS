/**
 * Stock movements API — POST /api/v1/inventory/movements (adjust).
 * Lokatsiya tuzatish: ikkita adjust (minus “qayerdan”, plus “qayerga”).
 */
import apiClient from './client';

export type CreateMovementPayload = {
  product_id: string;
  lot_id: string;
  location_id: string;
  qty_change: number;
  movement_type: 'adjust';
  reason_code?: string;
};

export async function createStockMovement(payload: CreateMovementPayload): Promise<{ id: string }> {
  const { data } = await apiClient.post<{ id: string }>('/inventory/movements', {
    ...payload,
    qty_change: Number(payload.qty_change),
  });
  return data;
}

export type TransferLocationPayload = {
  from_location_id: string;
  to_location_id: string;
};

export type TransferLocationResponse = {
  lines_transferred: number;
  movements_created: number;
};

export async function transferLocationStock(
  payload: TransferLocationPayload
): Promise<TransferLocationResponse> {
  const { data } = await apiClient.post<TransferLocationResponse>(
    '/inventory/movements/transfer-location',
    payload
  );
  return data;
}
