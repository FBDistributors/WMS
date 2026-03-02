import type {
  ActivePick,
  DashboardSummary,
  ExceptionItem,
  TodayOverviewItem,
} from '../types/dashboard'

export async function getDashboardSummary(): Promise<DashboardSummary> {
  return {
    totalOrders: 42,
    completedToday: 24,
    inPicking: 7,
    activePickers: 5,
    exceptions: 3,
    lowStock: 5,
    deltas: {
      totalOrders: '+8',
      completedToday: '+6 vs avg',
      inPicking: '+2',
      exceptions: '2 new',
      lowStock: '3 critical',
    },
  }
}

export async function getActivePicks(): Promise<ActivePick[]> {
  return [
    {
      id: 'pk-1',
      document_no: 'SO-0008',
      status: 'IN_PROGRESS',
      picked: 8,
      total: 14,
    },
    {
      id: 'pk-2',
      document_no: 'SO-0009',
      status: 'NEW',
      picked: 0,
      total: 6,
    },
    {
      id: 'pk-3',
      document_no: 'SO-0010',
      status: 'IN_PROGRESS',
      picked: 3,
      total: 5,
    },
  ]
}

export async function getTodayOverview(): Promise<TodayOverviewItem[]> {
  return [
    { id: 'ov-1', label: 'Top SKU: SKU-0003', value: '42 picks' },
    { id: 'ov-2', label: 'Top SKU: SKU-0012', value: '36 picks' },
    { id: 'ov-3', label: 'Completed picks', value: '24 docs' },
    { id: 'ov-4', label: 'Avg pick time', value: '7m 12s' },
  ]
}

export async function getExceptions(): Promise<ExceptionItem[]> {
  return [
    {
      id: 'ex-1',
      type: 'Not found',
      document_no: 'SO-0007',
      sku: 'SKU-0008',
      location: 'A-03-02',
      time: '10:24',
      status: 'open',
    },
    {
      id: 'ex-2',
      type: 'Short pick',
      document_no: 'SO-0006',
      sku: 'SKU-0010',
      location: 'B-01-01',
      time: '09:58',
      status: 'open',
    },
    {
      id: 'ex-3',
      type: 'Location issue',
      document_no: 'SO-0005',
      sku: 'SKU-0002',
      location: 'C-02-04',
      time: '09:10',
      status: 'resolved',
    },
  ]
}
