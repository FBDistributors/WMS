/**
 * API base URL: default — Render.
 * Agar Render boshqa manzil bersa: API_BASE_URL ni o‘rnating (masalan https://wms-api-xxxx.onrender.com).
 * To‘liq path kerak bo‘lsa: API_BASE_URL=https://.../api/v1 qilib qo‘ying.
 */
const PROD_API = 'https://wms-ngdm.onrender.com';

const getApiBaseUrl = (): string => {
  const fromEnv = typeof process !== 'undefined' && process.env?.API_BASE_URL;
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim().replace(/\/$/, '');
  return PROD_API;
};

export const env = {
  API_BASE_URL: getApiBaseUrl(),
} as const;
