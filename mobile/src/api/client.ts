import { env } from '../config/env';
import type { ProductByBarcode } from './types';

const BASE = env.API_BASE_URL.replace(/\/$/, '');
const API_V1 = `${BASE}/api/v1`;

/** Optional: set for authenticated requests (e.g. after login). */
let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_V1}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(url, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.detail ?? text;
    } catch {
      // use text as is
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getProductByBarcode(barcode: string): Promise<ProductByBarcode> {
    const encoded = encodeURIComponent(barcode.trim());
    return request<ProductByBarcode>(`/products/by-barcode/${encoded}`);
  },
};
