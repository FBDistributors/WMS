/**
 * Backend picking API response types (PickingListItem, PickingDocument, PickingLine).
 */
export interface PickingLine {
  id: string;
  product_name: string;
  sku?: string | null;
  barcode?: string | null;
  location_code: string;
  batch?: string | null;
  expiry_date?: string | null;
  qty_required: number;
  qty_picked: number;
}

export interface PickingProgress {
  picked: number;
  required: number;
}

export interface PickingDocument {
  id: string;
  reference_number: string;
  status: string;
  lines: PickingLine[];
  progress: PickingProgress;
}

export interface PickingListItem {
  id: string;
  reference_number: string;
  status: string;
  lines_total: number;
  lines_done: number;
  controlled_by_user_id?: string | null;
}

export interface PickLineResponse {
  line: PickingLine;
  progress: PickingProgress;
  document_status: string;
}
