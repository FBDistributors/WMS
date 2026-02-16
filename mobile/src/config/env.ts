/**
 * API base URL: change for dev/prod or use __DEV__.
 * For Android emulator, use 10.0.2.2 to reach host localhost.
 */
const DEV_API = 'http://10.0.2.2:8000';
const PROD_API = 'https://your-api.example.com';

export const env = {
  API_BASE_URL: __DEV__ ? DEV_API : PROD_API,
} as const;
