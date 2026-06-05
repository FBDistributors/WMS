import { useCallback, useEffect, useMemo, useState } from 'react'

export type ReturnsHistoryTableConfig = {
  visibleColumns: string[]
  columnOrder: string[]
}

const STORAGE_KEY = 'wms_returns_history_table_config_v1'

export const RETURNS_HISTORY_TABLE_COLUMN_IDS = [
  'doc_no',
  'customer',
  'status',
  'controller',
  'picker',
  'assigned_at',
  'created_at',
  'updated_at',
] as const

export type ReturnsHistoryTableColumnId = (typeof RETURNS_HISTORY_TABLE_COLUMN_IDS)[number]

export const DEFAULT_VISIBLE_RETURNS_HISTORY_COLUMNS: ReturnsHistoryTableColumnId[] = [
  ...RETURNS_HISTORY_TABLE_COLUMN_IDS,
]

const DEFAULT_CONFIG: ReturnsHistoryTableConfig = {
  visibleColumns: [...DEFAULT_VISIBLE_RETURNS_HISTORY_COLUMNS],
  columnOrder: [...RETURNS_HISTORY_TABLE_COLUMN_IDS],
}

const dedupe = (values: string[]) => Array.from(new Set(values))

const normalizeConfig = (value: ReturnsHistoryTableConfig | null): ReturnsHistoryTableConfig => {
  if (!value) return DEFAULT_CONFIG

  const columnOrder = dedupe(
    (Array.isArray(value.columnOrder) ? value.columnOrder : []).filter((id) =>
      RETURNS_HISTORY_TABLE_COLUMN_IDS.includes(id as ReturnsHistoryTableColumnId)
    )
  )

  const orderedColumns = [
    ...columnOrder,
    ...RETURNS_HISTORY_TABLE_COLUMN_IDS.filter((id) => !columnOrder.includes(id)),
  ]

  const visibleColumns = dedupe(
    (Array.isArray(value.visibleColumns) ? value.visibleColumns : []).filter((id) =>
      RETURNS_HISTORY_TABLE_COLUMN_IDS.includes(id as ReturnsHistoryTableColumnId)
    )
  )

  return {
    visibleColumns:
      visibleColumns.length > 0 ? visibleColumns : [...DEFAULT_VISIBLE_RETURNS_HISTORY_COLUMNS],
    columnOrder: orderedColumns,
  }
}

const loadConfig = (): ReturnsHistoryTableConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    return normalizeConfig(JSON.parse(raw) as ReturnsHistoryTableConfig)
  } catch {
    return DEFAULT_CONFIG
  }
}

export function useReturnsHistoryTableConfig() {
  const [config, setConfig] = useState<ReturnsHistoryTableConfig>(() => loadConfig())

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }, [config])

  const updateConfig = useCallback((next: ReturnsHistoryTableConfig) => {
    setConfig(normalizeConfig(next))
  }, [])

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG)
  }, [])

  return useMemo(
    () => ({
      config,
      updateConfig,
      resetConfig,
    }),
    [config, resetConfig, updateConfig]
  )
}
