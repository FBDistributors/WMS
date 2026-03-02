/**
 * Picker inventory API — webapp /api/v1/inventory/picker ga mos.
 */
import apiClient from './client';

const INV = '/inventory';

export type PickerLotInfo = {
  location_code: string;
  batch_no: string;
  expiry_date: string | null;
  available_qty: number;
  reserved_qty: number;
};

export type PickerInventoryItem = {
  product_id: string;
  name: string;
  code: string;
  main_barcode: string | null;
  best_location: string | null;
  available_qty: number;
  nearest_expiry: string | null;
  top_locations: PickerLotInfo[];
};

export type PickerInventoryListResponse = {
  items: PickerInventoryItem[];
  next_cursor: string | null;
};

export type PickerProductLocation = {
  location_id: string;
  location_code: string;
  lot_id: string;
  batch_no: string;
  expiry_date: string | null;
  on_hand_qty: number;
  reserved_qty: number;
  available_qty: number;
};

export type PickerProductDetailResponse = {
  product_id: string;
  name: string;
  code: string;
  main_barcode: string | null;
  locations: PickerProductLocation[];
};

export type PickerLocationOption = {
  id: string;
  code: string;
  name: string;
};

type ListParams = {
  q?: string;
  location_id?: string;
  limit?: number;
  cursor?: string;
};

export async function listPickerInventory(
  params: ListParams = {}
): Promise<PickerInventoryListResponse> {
  const { data } = await apiClient.get<PickerInventoryListResponse>(`${INV}/picker`, {
    params: { limit: params.limit ?? 30, ...params },
  });
  return data;
}

export async function listPickerLocations(): Promise<PickerLocationOption[]> {
  const { data } = await apiClient.get<PickerLocationOption[]>(`${INV}/picker/locations`);
  return data;
}

export async function getPickerProductDetail(
  productId: string
): Promise<PickerProductDetailResponse> {
  const { data } = await apiClient.get<PickerProductDetailResponse>(
    `${INV}/picker/${productId}`
  );
  return data;
}

/** Skaner uchun: barcode bo‘yicha mahsulot + qayerda qancha (lokatsiyalar) */
export type InventoryByBarcodeLocation = {
  location_code: string;
  available_qty: number;
};

export type InventoryByBarcodeResponse = {
  product_id: string;
  name: string;
  barcode: string | null;
  brand: string | null;
  best_locations: InventoryByBarcodeLocation[];
  fefo_lots: Array<{ batch_no: string; expiry_date: string | null; available_qty: number }>;
  total_available: number;
};

export async function getInventoryByBarcode(
  barcode: string
): Promise<InventoryByBarcodeResponse> {
  const trimmed = barcode.trim();
  if (!trimmed) throw new Error('Barcode bo‘sh bo‘lmasligi kerak');
  const { data } = await apiClient.get<InventoryByBarcodeResponse>(
    `${INV}/by-barcode/${encodeURIComponent(trimmed)}`
  );
  return data;
}

/** Lokatsiya tarkibi — inventarizatsiya: shu joydagi mahsulotlar va qoldiqlar */
export type LocationContentsItem = {
  product_id: string;
  lot_id: string;
  location_id: string;
  product_name: string;
  barcode: string | null;
  batch_no: string;
  expiry_date: string | null;
  available_qty: number;
};

export type LocationContentsResponse = {
  location_id: string;
  location_code: string;
  items: LocationContentsItem[];
};

export async function getLocationContents(
  locationCode: string
): Promise<LocationContentsResponse> {
  const code = locationCode.trim();
  if (!code) throw new Error('Lokatsiya kodi bo‘sh bo‘lmasligi kerak');
  const { data } = await apiClient.get<LocationContentsResponse>(
    `${INV}/location/${encodeURIComponent(code)}`
  );
  return data;
}
