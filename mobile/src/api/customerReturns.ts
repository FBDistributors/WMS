/**
 * Mijozdan qaytgan mahsulot — controller tekshiruvi, yig'uvchi, zaxiraga yozish.
 */
import apiClient from './client';

export type CustomerReturnLine = {
  id: string;
  product_id: string;
  location_id: string;
  product_name: string;
  location_code: string;
  qty: number;
  batch: string;
  expiry_date: string | null;
};

export type CustomerReturn = {
  id: string;
  doc_no: string;
  customer_id?: string | null;
  customer_name?: string | null;
  status: string;
  created_by_user_id: string | null;
  approved_by_user_id: string | null;
  assigned_picker_user_id: string | null;
  created_at: string;
  updated_at: string;
  lines: CustomerReturnLine[];
};

export type CustomerReturnListResponse = {
  items: CustomerReturn[];
  total: number;
};

export type CreateCustomerReturnLine = {
  product_id: string;
  location_id: string;
  qty: number;
  product_name: string;
  location_code: string;
  batch?: string | null;
  expiry_date?: string | null;
};

const PATH = '/customer-returns';

export async function createCustomerReturn(payload: {
  doc_no?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  lines: CreateCustomerReturnLine[];
}): Promise<CustomerReturn> {
  const { data } = await apiClient.post<CustomerReturn>(PATH, payload);
  return data;
}

export async function listCustomerReturns(params?: {
  status?: string;
  mine_as_picker?: boolean;
  limit?: number;
  offset?: number;
}): Promise<CustomerReturnListResponse> {
  const { data } = await apiClient.get<CustomerReturnListResponse>(PATH, { params });
  return data;
}

export async function getCustomerReturn(id: string): Promise<CustomerReturn> {
  const { data } = await apiClient.get<CustomerReturn>(`${PATH}/${id}`);
  return data;
}

export async function controllerApproveCustomerReturn(id: string): Promise<CustomerReturn> {
  const { data } = await apiClient.post<CustomerReturn>(`${PATH}/${id}/controller-approve`);
  return data;
}

export async function assignPickerCustomerReturn(id: string, picker_user_id: string): Promise<CustomerReturn> {
  const { data } = await apiClient.post<CustomerReturn>(`${PATH}/${id}/assign-picker`, { picker_user_id });
  return data;
}

export async function completeCustomerReturn(id: string): Promise<CustomerReturn> {
  const { data } = await apiClient.post<CustomerReturn>(`${PATH}/${id}/complete`);
  return data;
}
