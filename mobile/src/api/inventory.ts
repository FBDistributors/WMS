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
  zone_type?: string;
};

const ZONES_NO_EXPIRY_RESTRICTION = ['EXPIRED', 'DAMAGED', 'QUARANTINE'];

export function isNoExpiryRestrictionZone(zoneType?: string): boolean {
  return !!zoneType && ZONES_NO_EXPIRY_RESTRICTION.includes(zoneType);
}

type ListParams = {
  q?: string;
  location_id?: string;
  /** main | showroom — qoldiq qayerda (asosiy yoki showroom) */
  warehouse?: PickerWarehouseFilter;
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

/** main = asosiy ombor, showroom = showroom ombori — kirimda filter. */
export type PickerWarehouseFilter = 'main' | 'showroom';

export async function listPickerLocations(warehouse?: PickerWarehouseFilter): Promise<PickerLocationOption[]> {
  const params = warehouse ? { warehouse } : {};
  const { data } = await apiClient.get<PickerLocationOption[]>(`${INV}/picker/locations`, { params });
  return data;
}

export async function getPickerProductDetail(
  productId: string,
  warehouse?: PickerWarehouseFilter
): Promise<PickerProductDetailResponse> {
  const params = warehouse ? { warehouse } : {};
  const { data } = await apiClient.get<PickerProductDetailResponse>(
    `${INV}/picker/${productId}`,
    { params }
  );
  if (
    data == null ||
    typeof data !== 'object' ||
    data.product_id == null
  ) {
    throw new Error('Server javobi noto\u2018g\u2018ri');
  }
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
