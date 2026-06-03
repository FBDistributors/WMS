import { useCallback, useEffect, useMemo, useState } from 'react'

export type ReceivingTableConfig = {
  visibleColumns: string[]
  columnOrder: string[]
}

const STORAGE_KEY = 'wms_receiving_table_config_v1'

export const RECEIVING_TABLE_COLUMN_IDS = [
  'doc_no',
  'status',
  'received_by',
  'received_at',
  'code',
  'barcode',
  'product',
  'qty',
  'qoldiq',
  'batch',
  'expiry',
  'location',
] as const

export type ReceivingTableColumnId = (typeof RECEIVING_TABLE_COLUMN_IDS)[number]

export const DEFAULT_VISIBLE_RECEIVING_COLUMNS: ReceivingTableColumnId[] = [
  'doc_no',
  'status',
  'received_by',
  'received_at',
  'code',
  'barcode',
  'product',
  'qty',
  'qoldiq',
  'batch',
  'expiry',
  'location',
]

const DEFAULT_CONFIG: ReceivingTableConfig = {
  visibleColumns: [...DEFAULT_VISIBLE_RECEIVING_COLUMNS],
  columnOrder: [...RECEIVING_TABLE_COLUMN_IDS],
}

const dedupe = (values: string[]) => Array.from(new Set(values))

const normalizeConfig = (value: ReceivingTableConfig | null): ReceivingTableConfig => {
  if (!value) return DEFAULT_CONFIG

  const columnOrder = dedupe(
    (Array.isArray(value.columnOrder) ? value.columnOrder : []).filter((id) =>
      RECEIVING_TABLE_COLUMN_IDS.includes(id as ReceivingTableColumnId)
    )
  )

  const orderedColumns = [
    ...columnOrder,
    ...RECEIVING_TABLE_COLUMN_IDS.filter((id) => !columnOrder.includes(id)),
  ]

  const visibleColumns = dedupe(
    (Array.isArray(value.visibleColumns) ? value.visibleColumns : []).filter((id) =>
      RECEIVING_TABLE_COLUMN_IDS.includes(id as ReceivingTableColumnId)
    )
  )

  return {
    visibleColumns:
      visibleColumns.length > 0 ? visibleColumns : [...DEFAULT_VISIBLE_RECEIVING_COLUMNS],
    columnOrder: orderedColumns,
  }
}

const loadConfig = (): ReceivingTableConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    return normalizeConfig(JSON.parse(raw) as ReceivingTableConfig)
  } catch {
    return DEFAULT_CONFIG
  }
}

export function useReceivingTableConfig() {
  const [config, setConfig] = useState<ReceivingTableConfig>(() => loadConfig())

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }, [config])

  const updateConfig = useCallback((next: ReceivingTableConfig) => {
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
