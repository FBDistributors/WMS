import { useCallback, useEffect, useMemo, useState } from 'react'

export type MovementTableConfig = {
  visibleColumns: string[]
  columnOrder: string[]
}

const STORAGE_KEY = 'wms_movement_table_config_v1'

export const MOVEMENT_TABLE_COLUMN_IDS = [
  'from',
  'to',
  'qty',
  'code',
  'barcode',
  'product',
  'batch',
  'created_by',
  'created_at',
] as const

export type MovementTableColumnId = (typeof MOVEMENT_TABLE_COLUMN_IDS)[number]

export const DEFAULT_VISIBLE_MOVEMENT_COLUMNS: MovementTableColumnId[] = [
  'from',
  'to',
  'qty',
  'code',
  'barcode',
  'product',
  'batch',
  'created_by',
  'created_at',
]

const DEFAULT_CONFIG: MovementTableConfig = {
  visibleColumns: [...DEFAULT_VISIBLE_MOVEMENT_COLUMNS],
  columnOrder: [...MOVEMENT_TABLE_COLUMN_IDS],
}

const dedupe = (values: string[]) => Array.from(new Set(values))

const normalizeConfig = (value: MovementTableConfig | null): MovementTableConfig => {
  if (!value) return DEFAULT_CONFIG

  const columnOrder = dedupe(
    (Array.isArray(value.columnOrder) ? value.columnOrder : []).filter((id) =>
      MOVEMENT_TABLE_COLUMN_IDS.includes(id as MovementTableColumnId)
    )
  )

  const orderedColumns = [
    ...columnOrder,
    ...MOVEMENT_TABLE_COLUMN_IDS.filter((id) => !columnOrder.includes(id)),
  ]

  const visibleColumns = dedupe(
    (Array.isArray(value.visibleColumns) ? value.visibleColumns : []).filter((id) =>
      MOVEMENT_TABLE_COLUMN_IDS.includes(id as MovementTableColumnId)
    )
  )

  return {
    visibleColumns:
      visibleColumns.length > 0 ? visibleColumns : [...DEFAULT_VISIBLE_MOVEMENT_COLUMNS],
    columnOrder: orderedColumns,
  }
}

const loadConfig = (): MovementTableConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    return normalizeConfig(JSON.parse(raw) as MovementTableConfig)
  } catch {
    return DEFAULT_CONFIG
  }
}

export function useMovementTableConfig() {
  const [config, setConfig] = useState<MovementTableConfig>(() => loadConfig())

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }, [config])

  const updateConfig = useCallback((next: MovementTableConfig) => {
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
