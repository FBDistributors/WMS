/**
 * Offline queue: add events when offline, get pending/failed for UI and sync.
 */
import {
  queueAdd,
  queueGetPendingCount,
  queueGetAllForUI,
  queueUpdateStatus,
  queueSetPendingForRetry,
  type OfflineQueueItem,
  type QueueItemStatus,
} from './offlineDb';

export type QueueEventType =
  | 'PICK_SCAN'
  | 'PICK_SET_QTY'
  | 'PICK_CONFIRM_ITEM'
  | 'PICK_CLOSE_TASK';

export interface PickScanPayload {
  taskId: string;
  barcode: string;
  productId?: string;
  lineId?: string;
  ts: number;
}

export interface PickSetQtyPayload {
  taskId: string;
  itemId: string;
  qty: number;
  ts: number;
}

export interface PickConfirmItemPayload {
  taskId: string;
  itemId: string;
  qty: number;
  ts: number;
}

export interface PickCloseTaskPayload {
  taskId: string;
  ts: number;
  incomplete_reason?: string;
}

export type QueuePayload = PickScanPayload | PickSetQtyPayload | PickConfirmItemPayload | PickCloseTaskPayload;

function genId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function addToQueue(type: QueueEventType, payload: QueuePayload): Promise<string> {
  const id = genId();
  await queueAdd(id, type, payload, 'pending');
  return id;
}

export async function getPendingCount(): Promise<number> {
  return queueGetPendingCount();
}

export async function getQueueForUI(): Promise<{ pending: OfflineQueueItem[]; failed: OfflineQueueItem[] }> {
  return queueGetAllForUI();
}

export async function setItemSyncing(id: string): Promise<void> {
  await queueUpdateStatus(id, 'syncing', null);
}

export async function setItemDone(id: string): Promise<void> {
  await queueUpdateStatus(id, 'done', null);
}

export async function setItemFailed(id: string, error: string): Promise<void> {
  await queueUpdateStatus(id, 'failed', error);
}

export async function retryFailedItem(id: string): Promise<void> {
  await queueSetPendingForRetry(id);
}

export { type OfflineQueueItem };
