export interface ProductByBarcode {
  id: string;
  name: string;
  sku: string;
  brand: string | null;
  barcode: string | null;
  barcodes: string[];
  on_hand_total: number | null;
  available_total: number | null;
  is_active: boolean;
  created_at: string;
}
