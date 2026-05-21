import { fetchJSON } from './apiClient'

export type WorkZone = {
  id: string
  room_id: string
  name: string | null
  created_at: string
}

export type WorkZoneCreateInput = {
  room_id: string
  name?: string | null
}

export type WorkZoneUpdateInput = {
  room_id?: string | null
  name?: string | null
}

export async function getWorkZones(search?: string, limit = 100, offset = 0) {
  return fetchJSON<WorkZone[]>('/api/v1/work-zones', {
    query: { search, limit, offset },
  })
}

export async function createWorkZone(payload: WorkZoneCreateInput) {
  return fetchJSON<WorkZone>('/api/v1/work-zones', { method: 'POST', body: payload })
}

export async function updateWorkZone(id: string, payload: WorkZoneUpdateInput) {
  return fetchJSON<WorkZone>(`/api/v1/work-zones/${id}`, { method: 'PUT', body: payload })
}

export async function deleteWorkZone(id: string) {
  return fetchJSON<void>(`/api/v1/work-zones/${id}`, { method: 'DELETE' })
}
