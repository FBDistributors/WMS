import { useCallback, useEffect, useMemo, useState } from 'react'

export type KamomatTableConfig = {
  visibleColumns: string[]
  columnOrder: string[]
}

const STORAGE_KEY = 'wms_kamomat_table_config_v1'

export const KAMOMAT_TABLE_COLUMN_IDS = [
  'movement_type',
  'qty',
  'code',
  'barcode',
  'product',
  'lot',
  'location',
  'created_by',
  'created_at',
] as const

export type KamomatTableColumnId = (typeof KAMOMAT_TABLE_COLUMN_IDS)[number]

export const DEFAULT_VISIBLE_KAMOMAT_COLUMNS: KamomatTableColumnId[] = [
  'movement_type',
  'qty',
  'code',
  'barcode',
  'product',
  'lot',
  'location',
  'created_by',
  'created_at',
]

const DEFAULT_CONFIG: KamomatTableConfig = {
  visibleColumns: [...DEFAULT_VISIBLE_KAMOMAT_COLUMNS],
  columnOrder: [...KAMOMAT_TABLE_COLUMN_IDS],
}

const dedupe = (values: string[]) => Array.from(new Set(values))

const normalizeConfig = (value: KamomatTableConfig | null): KamomatTableConfig => {
  if (!value) return DEFAULT_CONFIG

  const columnOrder = dedupe(
    (Array.isArray(value.columnOrder) ? value.columnOrder : []).filter((id) =>
      KAMOMAT_TABLE_COLUMN_IDS.includes(id as KamomatTableColumnId)
    )
  )

  const orderedColumns = [
    ...columnOrder,
    ...KAMOMAT_TABLE_COLUMN_IDS.filter((id) => !columnOrder.includes(id)),
  ]

  const visibleColumns = dedupe(
    (Array.isArray(value.visibleColumns) ? value.visibleColumns : []).filter((id) =>
      KAMOMAT_TABLE_COLUMN_IDS.includes(id as KamomatTableColumnId)
    )
  )

  return {
    visibleColumns:
      visibleColumns.length > 0 ? visibleColumns : [...DEFAULT_VISIBLE_KAMOMAT_COLUMNS],
    columnOrder: orderedColumns,
  }
}

const loadConfig = (): KamomatTableConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    return normalizeConfig(JSON.parse(raw) as KamomatTableConfig)
  } catch {
    return DEFAULT_CONFIG
  }
}

export function useKamomatTableConfig() {
  const [config, setConfig] = useState<KamomatTableConfig>(() => loadConfig())

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }, [config])

  const updateConfig = useCallback((next: KamomatTableConfig) => {
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
