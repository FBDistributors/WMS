/**
 * Sync engine: when online, process pending queue FIFO.
 * PICK_SCAN -> submitScan; PICK_SET_QTY / PICK_CONFIRM_ITEM -> pickLine; PICK_CLOSE_TASK -> complete.
 */
import apiClient, { UNAUTHORIZED_MSG } from '../api/client';
import { completePickDocument, getTaskById, pickLine, submitScan } from '../api/picking';
import { queueGetPending, queueUpdateStatus } from './offlineDb';
import type { PickScanPayload, PickSetQtyPayload, PickCloseTaskPayload } from './offlineQueue';

export type SyncResult = { ok: boolean; needReauth?: boolean; error?: string };

export async function syncPendingQueue(onItemDone?: (id: string) => void): Promise<SyncResult> {
  const pending = await queueGetPending();
  for (const item of pending) {
    try {
      await queueUpdateStatus(item.id, 'syncing', null);
      const payload = JSON.parse(item.payload_json) as Record<string, unknown>;
      switch (item.type) {
        case 'PICK_SCAN': {
          const p = payload as unknown as PickScanPayload;
          await submitScan(p.taskId, { barcode: p.barcode, qty: 1 });
          break;
        }
        case 'PICK_SET_QTY':
        case 'PICK_CONFIRM_ITEM': {
          const p = payload as unknown as PickSetQtyPayload;
          const count = p.qty ?? 1;
          for (let i = 0; i < count; i++) {
            await pickLine(p.itemId, 1, `sync-${item.id}-${i}-${Date.now()}`);
          }
          break;
        }
        case 'PICK_CLOSE_TASK': {
          const p = payload as unknown as PickCloseTaskPayload;
          await completePickDocument(p.taskId, p.incomplete_reason ? { incomplete_reason: p.incomplete_reason } : undefined);
          break;
        }
        default:
          await queueUpdateStatus(item.id, 'failed', `Unknown type: ${item.type}`);
          continue;
      }
      await queueUpdateStatus(item.id, 'done', null);
      onItemDone?.(item.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === UNAUTHORIZED_MSG) {
        await queueUpdateStatus(item.id, 'pending', null);
        return { ok: false, needReauth: true, error: msg };
      }
      await queueUpdateStatus(item.id, 'failed', msg);
      return { ok: false, error: msg };
    }
  }
  return { ok: true };
}
