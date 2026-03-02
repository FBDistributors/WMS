/**
 * Picker / Yig'uvchi — types (web'dagi PickingDocument / PickingLine ga mos).
 */

export type PickTaskStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled' | 'paused';

export interface PickItem {
  id: string;
  product_name: string;
  sku?: string;
  barcode?: string;
  location_code: string;
  qty_required: number;
  qty_picked: number;
}

export interface PickTask {
  id: string;
  reference_number: string;
  status: PickTaskStatus;
  lines: PickItem[];
}

export interface PickProgress {
  picked: number;
  required: number;
  linesDone: number;
  linesTotal: number;
}
