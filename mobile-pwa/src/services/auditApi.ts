import { fetchJSON } from './apiClient'

export type AuditLogRecord = {
  id: string
  user_id: string | null
  username: string | null
  action: string
  entity_type: string
  entity_id: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export type AuditLogListResponse = {
  items: AuditLogRecord[]
  total: number
  limit: number
  offset: number
}

export type ListAuditLogsParams = {
  entity_type?: string
  entity_id?: string
  user_id?: string
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}

export async function listAuditLogs(params: ListAuditLogsParams = {}) {
  const query: Record<string, string | number | undefined> = {
    limit: params.limit,
    offset: params.offset,
  }
  if (params.entity_type) query.entity_type = params.entity_type
  if (params.entity_id) query.entity_id = params.entity_id
  if (params.user_id) query.user_id = params.user_id
  if (params.date_from) query.date_from = params.date_from
  if (params.date_to) query.date_to = params.date_to
  return fetchJSON<AuditLogListResponse>('/api/v1/audit', { query })
}
