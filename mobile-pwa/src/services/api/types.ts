export type DocumentStatus =
  | 'draft'
  | 'confirmed'
  | 'in_progress'
  | 'partial'
  | 'completed'
  | 'cancelled'

export type DocumentType = 'SO' | 'PO' | 'TRANSFER'

export type DocumentItem = {
  id: string
  product_id: string
  product_name?: string
  sku?: string
  barcode?: string
  required_quantity: number
  picked_quantity?: number
  remaining_quantity?: number
  location_id?: string
  location_code?: string
  status?: 'pending' | 'partial' | 'done'
}

export type Document = {
  id: string
  document_number?: string
  reference?: string
  status: DocumentStatus
  type: DocumentType
  created_at?: string
  priority?: number
  items?: DocumentItem[]
}

export type DocumentLine = {
  line_id: string
  product_id: string
  product_name: string
  sku?: string
  barcode?: string
  location_code: string
  qty_required: number
  qty_picked: number
}

export type DocumentListItem = {
  id: string
  doc_type: DocumentType
  reference_number: string
  status: DocumentStatus
  lines_total: number
  lines_done: number
}

export type DocumentDetails = DocumentListItem & {
  lines: DocumentLine[]
}

export type StockMovementCreate = {
  movement_type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT'
  document_id: string
  product_id: string
  quantity: number
  request_id: string
  reference_number?: string
  note?: string
  mode?: 'scan_each' | 'scan_with_qty'
  from_location_id?: string
  to_location_id?: string
  batch_number?: string
  expiry_date?: string
}
