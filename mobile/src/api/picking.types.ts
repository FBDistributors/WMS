/**
 * Backend picking API response types (PickingListItem, PickingDocument, PickingLine).
 */
export type PickingAlternateLocation = {
  location_id: string;
  location_code: string;
  lot_id: string;
  available_qty: number;
  batch?: string | null;
  expiry_date?: string | null;
  is_primary: boolean;
};

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
  skip_reason?: string | null;
  product_id?: string | null;
  alternate_locations?: PickingAlternateLocation[];
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
  /** Yig'uvchi to'liq yig'maganda tanlagan sabab (controller ko'radi). */
  incomplete_reason?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to_user_name?: string | null;
  /** Buyurtma raqami (order dan; admin bilan bir xil). */
  order_number?: string | null;
}

export interface PickingListItem {
  id: string;
  reference_number: string;
  status: string;
  lines_total: number;
  lines_done: number;
  controlled_by_user_id?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to_user_name?: string | null;
  /** Buyurtma raqami (order dan; admin bilan bir xil). */
  order_number?: string | null;
  /** Tashkiliy harakat yetkazib berish raqami (backend Order.delivery_number). */
  delivery_number?: string | null;
  /** Yig'uvchi controllerga yuborgan vaqt (ISO). */
  sent_to_controller_at?: string | null;
}

export interface PickLineResponse {
  line: PickingLine;
  progress: PickingProgress;
  document_status: string;
}

/** Per-document line inside a product group (bu mahsulot bu buyurtma). */
export interface ConsolidatedLineItem {
  document_id: string;
  line_id: string;
  reference_number: string;
  qty_required: number;
  qty_picked: number;
  location_code: string;
  pick_sequence?: number | null;
  expiry_date?: string | null;
}

export interface ConsolidatedProduct {
  barcode?: string | null;
  sku?: string | null;
  product_name: string;
  product_id?: string | null;
  total_required: number;
  total_picked: number;
  expiry_date?: string | null;
  alternate_locations?: PickingAlternateLocation[];
  lines: ConsolidatedLineItem[];
}

export interface ConsolidatedDocumentSummary {
  id: string;
  reference_number: string;
  status: string;
  lines_total: number;
  lines_done: number;
}

export interface ConsolidatedViewResponse {
  documents: ConsolidatedDocumentSummary[];
  products: ConsolidatedProduct[];
}
