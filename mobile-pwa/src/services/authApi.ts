import { fetchJSON } from './apiClient'

const TOKEN_KEY = 'wms_token'

export type AuthUser = {
  id: string
  username: string
  full_name?: string | null
  role: string
  permissions: string[]
}

type LoginResponse = {
  access_token: string
  token_type: string
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function login(username: string, password: string) {
  const data = await fetchJSON<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: { username, password },
  })
  setToken(data.access_token)
  return data
}

export async function getMe() {
  return fetchJSON<AuthUser>('/api/v1/auth/me')
}

export async function logout() {
  try {
    await fetchJSON('/api/v1/auth/logout', { method: 'POST' })
  } catch {
    // Ignore errors, clear token anyway
  }
  clearToken()
}
