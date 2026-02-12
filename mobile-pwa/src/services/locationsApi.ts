import { fetchJSON } from './apiClient'

export type LocationType = 'zone' | 'rack' | 'shelf' | 'bin'
export type LocationTypeEnum = 'RACK' | 'FLOOR'

export type Location = {
  id: string
  code: string
  name: string
  type: LocationType
  location_type?: LocationTypeEnum | null
  sector?: string | null
  level?: number | null
  row_no?: number | null
  pallet_no?: number | null
  parent_id?: string | null
  is_active: boolean
  created_at?: string | null
}

export type LocationCreateInput = {
  code: string
  name: string
  type: LocationType
  location_type?: LocationTypeEnum | null
  parent_id?: string | null
  is_active?: boolean
}

export type LocationUpdateInput = {
  code?: string
  name?: string
  type?: LocationType
  location_type?: LocationTypeEnum | null
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
