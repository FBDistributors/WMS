import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { env } from '../config/env';

const TOKEN_KEY = '@wms_access_token';

const BASE = env.API_BASE_URL.replace(/\/$/, '');
export const API_V1 = BASE.includes('/api/v1') ? BASE : `${BASE}/api/v1`;

export const apiClient = axios.create({
  baseURL: API_V1,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

export async function getStoredToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setAuthToken(token: string | null): Promise<void> {
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await getStoredToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (err) => Promise.reject(err)
);

export const UNAUTHORIZED_MSG = 'UNAUTHORIZED';

apiClient.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<{ detail?: string | { message?: string } }>) => {
    if (err.response?.status === 401) {
      await AsyncStorage.removeItem(TOKEN_KEY);
      return Promise.reject(new Error(UNAUTHORIZED_MSG));
    }
    if (err.response?.status === 404) {
      const url = err.config?.url ? `${err.config.baseURL || ''}${err.config.url}` : '';
      return Promise.reject(
        new Error(`Yo‘l topilmadi (404). Tekshiring: ${url || 'URL noma’lum'}`)
      );
    }
    if (err.response?.status === 500) {
      return Promise.reject(
        new Error('Server xatosi (500). Keyinroq urinib ko\'ring yoki administrator bilan bog\'laning.')
      );
    }
    if (err.response?.status && err.response.status >= 500) {
      return Promise.reject(
        new Error('Server xatosi. Keyinroq urinib ko\'ring.')
      );
    }
    const message =
      err.response?.data?.detail != null
        ? typeof err.response.data.detail === 'string'
          ? err.response.data.detail
          : (err.response.data.detail as { message?: string })?.message ?? err.message
        : err.message ?? 'Tarmoq xatosi';
    return Promise.reject(new Error(message));
  }
);

export default apiClient;
