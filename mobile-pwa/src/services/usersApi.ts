import { fetchJSON } from './apiClient'
import type {
  CreateUserPayload,
  ResetPasswordPayload,
  UpdateUserPayload,
  UserRecord,
  UsersListResponse,
} from '../types/users'

export type ListUsersParams = {
  q?: string
  limit?: number
  offset?: number
}

export async function listUsers(params: ListUsersParams = {}) {
  return fetchJSON<UsersListResponse>('/api/v1/users', {
    query: {
      q: params.q,
      limit: params.limit,
      offset: params.offset,
    },
  })
}

export async function getUser(id: string) {
  return fetchJSON<UserRecord>(`/api/v1/users/${id}`)
}

export async function createUser(payload: CreateUserPayload) {
  return fetchJSON<UserRecord>('/api/v1/users', {
    method: 'POST',
    body: payload,
  })
}

export async function updateUser(id: string, payload: UpdateUserPayload) {
  return fetchJSON<UserRecord>(`/api/v1/users/${id}`, {
    method: 'PATCH',
    body: payload,
  })
}

export async function resetPassword(id: string, payload: ResetPasswordPayload) {
  return fetchJSON<{ status: string }>(`/api/v1/users/${id}/reset-password`, {
    method: 'POST',
    body: payload,
  })
}

export async function disableUser(id: string) {
  return fetchJSON<UserRecord>(`/api/v1/users/${id}`, {
    method: 'DELETE',
  })
}
