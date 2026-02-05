export type DashboardSummary = {
  openPickLists: number
  completedToday: number
  exceptions: number
  lowStock: number
  deltas?: {
    openPickLists?: string
    completedToday?: string
    exceptions?: string
    lowStock?: string
  }
}

export type ActivePick = {
  id: string
  document_no: string
  status: 'NEW' | 'IN_PROGRESS' | 'DONE'
  picked: number
  total: number
}

export type TodayOverviewItem = {
  id: string
  label: string
  value: string
}

export type ExceptionItem = {
  id: string
  type: 'Not found' | 'Short pick' | 'Location issue'
  document_no: string
  sku: string
  location: string
  time: string
  status: 'open' | 'resolved'
}
