import { fetchJSON } from './apiClient'

export type SettingsOrganization = {
  id: string
  org_id: string
  name: string | null
  created_at: string
}

export type SettingsOrganizationCreateInput = {
  org_id: string
  name?: string | null
}

export type SettingsOrganizationUpdateInput = {
  org_id?: string | null
  name?: string | null
}

export async function getSettingsOrganizations(search?: string, limit = 100, offset = 0) {
  return fetchJSON<SettingsOrganization[]>('/api/v1/settings-organizations', {
    query: { search, limit, offset },
  })
}

export async function createSettingsOrganization(payload: SettingsOrganizationCreateInput) {
  return fetchJSON<SettingsOrganization>('/api/v1/settings-organizations', {
    method: 'POST',
    body: payload,
  })
}

export async function updateSettingsOrganization(
  id: string,
  payload: SettingsOrganizationUpdateInput,
) {
  return fetchJSON<SettingsOrganization>(`/api/v1/settings-organizations/${id}`, {
    method: 'PUT',
    body: payload,
  })
}

export async function deleteSettingsOrganization(id: string) {
  return fetchJSON<void>(`/api/v1/settings-organizations/${id}`, { method: 'DELETE' })
}
