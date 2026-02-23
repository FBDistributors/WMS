import { useCallback, useEffect, useMemo, useState } from 'react'

export type InventoryTableConfig = {
  visibleColumns: string[]
  columnOrder: string[]
}

const STORAGE_KEY = 'wms_inventory_table_config'

export const INVENTORY_TABLE_COLUMN_IDS = [
  'code',
  'barcode',
  'product',
  'brand',
  'total_qty',
  'available',
]

export const DEFAULT_VISIBLE_COLUMNS = [
  'code',
  'barcode',
  'product',
  'brand',
  'total_qty',
  'available',
]

const DEFAULT_CONFIG: InventoryTableConfig = {
  visibleColumns: DEFAULT_VISIBLE_COLUMNS,
  columnOrder: INVENTORY_TABLE_COLUMN_IDS,
}

const dedupe = (values: string[]) => Array.from(new Set(values))

const ensureSelectColumn = (ids: string[]) =>
  ids.filter((id) => INVENTORY_TABLE_COLUMN_IDS.includes(id)).length > 0
    ? ids
    : INVENTORY_TABLE_COLUMN_IDS

const normalizeConfig = (value: InventoryTableConfig | null) => {
  if (!value) return DEFAULT_CONFIG

  const columnOrder = dedupe(
    (Array.isArray(value.columnOrder) ? value.columnOrder : [])
      .filter((id) => INVENTORY_TABLE_COLUMN_IDS.includes(id))
  )

  const orderedColumns = [
    ...columnOrder,
    ...INVENTORY_TABLE_COLUMN_IDS.filter((id) => !columnOrder.includes(id)),
  ]

  const visibleColumns = dedupe(
    (Array.isArray(value.visibleColumns) ? value.visibleColumns : [])
      .filter((id) => INVENTORY_TABLE_COLUMN_IDS.includes(id))
  )

  const finalVisible =
    visibleColumns.length > 0 ? visibleColumns : DEFAULT_VISIBLE_COLUMNS

  return {
    visibleColumns: ensureSelectColumn(finalVisible),
    columnOrder: orderedColumns,
  }
}

const loadConfig = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    return normalizeConfig(JSON.parse(raw) as InventoryTableConfig)
  } catch {
    return DEFAULT_CONFIG
  }
}

export function useInventoryTableConfig() {
  const [config, setConfig] = useState<InventoryTableConfig>(() => loadConfig())

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }, [config])

  const updateConfig = useCallback((next: InventoryTableConfig) => {
    setConfig(normalizeConfig(next))
  }, [])

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG)
  }, [])

  return useMemo(
    () => ({ config, updateConfig, resetConfig }),
    [config, resetConfig, updateConfig]
  )
}
