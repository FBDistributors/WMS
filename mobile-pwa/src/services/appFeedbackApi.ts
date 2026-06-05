import { fetchJSON } from './apiClient'

export type AppFeedbackRecord = {
  id: string
  user_id: string
  username: string | null
  full_name: string | null
  rating: number
  comment: string | null
  role: string
  module: string
  context_ref: string | null
  app_version: string | null
  platform: string | null
  created_at: string
}

export type AppFeedbackStats = {
  average_rating: number | null
  picker_average: number | null
  controller_average: number | null
  total_count: number
}

export type AppFeedbackListResponse = {
  items: AppFeedbackRecord[]
  total: number
  limit: number
  offset: number
  stats: AppFeedbackStats
}

export type ListAppFeedbackParams = {
  role?: string
  module?: string
  rating?: number
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}

export async function listAppFeedback(params: ListAppFeedbackParams = {}) {
  const query: Record<string, string | number | undefined> = {
    limit: params.limit,
    offset: params.offset,
  }
  if (params.role) query.role = params.role
  if (params.module) query.module = params.module
  if (params.rating != null) query.rating = params.rating
  if (params.date_from) query.date_from = params.date_from
  if (params.date_to) query.date_to = params.date_to
  return fetchJSON<AppFeedbackListResponse>('/api/v1/app-feedback', { query })
}
