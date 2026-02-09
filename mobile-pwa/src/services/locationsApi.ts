import { fetchJSON } from './apiClient'

export type Location = {
  id: string
  code: string
  name: string
  type: string
  parent_id?: string | null
  is_active: boolean
}

export type LocationCreateInput = {
  code: string
  name: string
  type: string
  parent_id?: string | null
  is_active?: boolean
}

export type LocationUpdateInput = {
  code?: string
  name?: string
  type?: string
  parent_id?: string | null
  is_active?: boolean
}

export async function getLocations(includeInactive = false) {
  return fetchJSON<Location[]>('/api/v1/locations', {
    query: { include_inactive: includeInactive },
  })
}

export async function createLocation(payload: LocationCreateInput) {
  return fetchJSON<Location>('/api/v1/locations', { method: 'POST', body: payload })
}

export async function updateLocation(id: string, payload: LocationUpdateInput) {
  return fetchJSON<Location>(`/api/v1/locations/${id}`, { method: 'PATCH', body: payload })
}

export async function deactivateLocation(id: string) {
  return fetchJSON<Location>(`/api/v1/locations/${id}`, { method: 'DELETE' })
}
