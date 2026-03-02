/**
 * Offline storage: SQLite for cache + queue.
 * Schema: cached_pick_tasks, cached_pick_task_items, barcode_index, offline_queue.
 */
import SQLite, { SQLiteDatabase } from 'react-native-sqlite-storage';

SQLite.DEBUG(false);
SQLite.enablePromise(true);

const DB_NAME = 'wms_offline.db';

let dbInstance: SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabase({
    name: DB_NAME,
    location: 'default',
  });
  await initSchema(dbInstance);
  return dbInstance;
}

async function initSchema(db: SQLiteDatabase): Promise<void> {
  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS cached_pick_tasks (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS cached_pick_task_items (
      task_id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS barcode_index (
      barcode TEXT PRIMARY KEY,
      product_id TEXT,
      task_id TEXT,
      line_id TEXT,
      payload_json TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS offline_queue (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    );
  `);
}

// --- Cached pick tasks (list) ---
export async function saveCachedPickTasks(tasks: unknown[]): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  for (const task of tasks) {
    const id = (task as { id: string }).id;
    if (!id) continue;
    await db.executeSql(
      `INSERT OR REPLACE INTO cached_pick_tasks (id, data_json, updated_at) VALUES (?, ?, ?)`,
      [id, JSON.stringify(task), now]
    );
  }
}

function rowsToArray(res: { rows: { length: number; item: (i: number) => Record<string, unknown> } }): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < res.rows.length; i++) {
    out.push(res.rows.item(i));
  }
  return out;
}

export async function getCachedPickTasks(): Promise<unknown[]> {
  const db = await getDb();
  const [res] = await db.executeSql(
    `SELECT data_json FROM cached_pick_tasks ORDER BY updated_at DESC`
  );
  return rowsToArray(res).map((r) => JSON.parse(String(r.data_json)));
}

// --- Cached pick task detail (single document with lines) ---
export async function saveCachedPickTaskDetail(taskId: string, doc: unknown): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.executeSql(
    `INSERT OR REPLACE INTO cached_pick_task_items (task_id, data_json, updated_at) VALUES (?, ?, ?)`,
    [taskId, JSON.stringify(doc), now]
  );
  const lines = (doc as { lines?: Array<{ barcode?: string; sku?: string; id: string; product_name?: string }> }).lines ?? [];
  for (const line of lines) {
    const barcode = (line.barcode || line.sku || '').trim().toLowerCase();
    if (!barcode) continue;
    await db.executeSql(
      `INSERT OR REPLACE INTO barcode_index (barcode, product_id, task_id, line_id, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        barcode,
        (line as unknown as { product_id?: string }).product_id ?? '',
        taskId,
        line.id,
        JSON.stringify(line),
        now,
      ]
    );
  }
}

export async function getCachedPickTaskDetail(taskId: string): Promise<unknown | null> {
  const db = await getDb();
  const [res] = await db.executeSql(
    `SELECT data_json FROM cached_pick_task_items WHERE task_id = ?`,
    [taskId]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows.item(0) as { data_json: string };
  return JSON.parse(row.data_json);
}

// --- Barcode index (for offline scan) ---
export interface BarcodeIndexRow {
  barcode: string;
  product_id: string;
  task_id: string;
  line_id: string;
  payload_json: string;
}

export async function getBarcodeFromIndex(barcode: string): Promise<BarcodeIndexRow | null> {
  const db = await getDb();
  const key = barcode.trim().toLowerCase();
  if (!key) return null;
  const [res] = await db.executeSql(
    `SELECT barcode, product_id, task_id, line_id, payload_json FROM barcode_index WHERE barcode = ?`,
    [key]
  );
  if (res.rows.length === 0) return null;
  return res.rows.item(0) as unknown as BarcodeIndexRow;
}

// --- Offline queue ---
export type QueueItemStatus = 'pending' | 'syncing' | 'failed' | 'done';

export interface OfflineQueueItem {
  id: string;
  type: string;
  payload_json: string;
  created_at: number;
  status: QueueItemStatus;
  error: string | null;
}

export async function queueAdd(
  id: string,
  type: string,
  payload: object,
  status: QueueItemStatus = 'pending'
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.executeSql(
    `INSERT OR REPLACE INTO offline_queue (id, type, payload_json, created_at, status, error) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, type, JSON.stringify(payload), now, status, null]
  );
}

export async function queueUpdateStatus(
  id: string,
  status: QueueItemStatus,
  error: string | null = null
): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    `UPDATE offline_queue SET status = ?, error = ? WHERE id = ?`,
    [status, error, id]
  );
}

export async function queueGetPending(): Promise<OfflineQueueItem[]> {
  const db = await getDb();
  const [res] = await db.executeSql(
    `SELECT id, type, payload_json, created_at, status, error FROM offline_queue WHERE status = 'pending' ORDER BY created_at ASC`
  );
  return rowsToArray(res).map((r) => ({
    id: r.id,
    type: r.type,
    payload_json: r.payload_json,
    created_at: r.created_at,
    status: r.status,
    error: r.error,
  })) as OfflineQueueItem[];
}

export async function queueGetFailed(): Promise<OfflineQueueItem[]> {
  const db = await getDb();
  const [res] = await db.executeSql(
    `SELECT id, type, payload_json, created_at, status, error FROM offline_queue WHERE status = 'failed' ORDER BY created_at ASC`
  );
  return rowsToArray(res).map((r) => ({
    id: r.id,
    type: r.type,
    payload_json: r.payload_json,
    created_at: r.created_at,
    status: r.status,
    error: r.error,
  })) as OfflineQueueItem[];
}

export async function queueGetPendingCount(): Promise<number> {
  const db = await getDb();
  const [res] = await db.executeSql(
    `SELECT COUNT(*) as cnt FROM offline_queue WHERE status = 'pending'`
  );
  if (res.rows.length === 0) return 0;
  const row = res.rows.item(0) as { cnt: number };
  return typeof row.cnt === 'number' ? row.cnt : 0;
}

export async function queueGetAllForUI(): Promise<{ pending: OfflineQueueItem[]; failed: OfflineQueueItem[] }> {
  const [pending, failed] = await Promise.all([queueGetPending(), queueGetFailed()]);
  return { pending, failed };
}

export async function queueSetPendingForRetry(id: string): Promise<void> {
  await queueUpdateStatus(id, 'pending', null);
}
