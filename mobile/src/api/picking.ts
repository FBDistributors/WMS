/**
 * Picker flow API — backend /api/v1/picking ga mos.
 */
import apiClient from './client';
import type { PickingListItem, PickingDocument, PickLineResponse } from './picking.types';

const PICKING = '/picking';

export interface MyPickerStatsDay {
  date: string;
  count: number;
}

export interface MyPickerStats {
  total_completed: number;
  completed_today: number;
  by_day: MyPickerStatsDay[];
}

export async function getMyPickerStats(days = 7): Promise<MyPickerStats> {
  const { data } = await apiClient.get<MyPickerStats>(`${PICKING}/my-stats`, {
    params: { days },
  });
  return data;
}

export interface ControllerUser {
  id: string;
  username: string;
  full_name: string | null;
}

export async function getOpenTasks(limit = 50, offset = 0): Promise<PickingListItem[]> {
  const { data } = await apiClient.get<PickingListItem[]>(`${PICKING}/documents`, {
    params: { limit, offset, include_cancelled: false },
  });
  return data;
}

export async function getControllers(): Promise<ControllerUser[]> {
  const { data } = await apiClient.get<ControllerUser[]>(`${PICKING}/controllers`);
  return data;
}

export async function sendToController(documentId: string, controllerUserId: string): Promise<PickingDocument> {
  const { data } = await apiClient.post<PickingDocument>(
    `${PICKING}/documents/${documentId}/send-to-controller`,
    { controller_user_id: controllerUserId }
  );
  return data;
}

export async function getTaskById(documentId: string): Promise<PickingDocument> {
  const { data } = await apiClient.get<PickingDocument>(`${PICKING}/documents/${documentId}`);
  return data;
}

/** Bitta qator uchun +1 yoki -1 (backend: delta + request_id). */
export async function pickLine(
  lineId: string,
  delta: 1 | -1,
  requestId: string
): Promise<PickLineResponse> {
  const { data } = await apiClient.post<PickLineResponse>(`${PICKING}/lines/${lineId}/pick`, {
    delta,
    request_id: requestId,
  });
  return data;
}

/**
 * Shtrixkod yoki SKU bo'yicha topib, bitta birlik terish (+1).
 * Agar qty berilsa, shuncha marta pickLine(+1) chaqiriladi.
 */
export async function submitScan(
  taskId: string,
  payload: { barcode: string; qty?: number }
): Promise<PickLineResponse> {
  const doc = await getTaskById(taskId);
  const q = (payload.barcode || '').trim().toLowerCase();
  const line = doc.lines.find(
    (l) =>
      (l.barcode && l.barcode.toLowerCase() === q) ||
      (l.sku && l.sku.toLowerCase() === q) ||
      (l.product_name && l.product_name.toLowerCase().includes(q))
  );
  if (!line) throw new Error(`"${payload.barcode}" bo'yicha pozitsiya topilmadi`);
  const count = Math.max(1, Math.floor(payload.qty ?? 1));
  if (line.qty_picked + count > line.qty_required) {
    throw new Error(`Kerakli miqdor: ${line.qty_required}, terilgan: ${line.qty_picked}`);
  }
  let last: PickLineResponse = null!;
  for (let i = 0; i < count; i++) {
    last = await pickLine(line.id, 1, `scan-${taskId}-${line.id}-${Date.now()}-${i}`);
  }
  return last;
}
