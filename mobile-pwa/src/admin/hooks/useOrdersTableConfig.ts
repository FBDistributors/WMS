import { useCallback, useEffect, useMemo, useState } from 'react'

export type OrdersTableConfig = {
  visibleColumns: string[]
  columnOrder: string[]
  searchFields: string[]
}

const STORAGE_KEY = 'wms_orders_table_config'

export const ORDERS_TABLE_COLUMN_IDS = [
  'select',
  'order_number',
  'external_id',
  'customer',
  'customer_id',
  'agent',
  'total_amount',
  'status',
  'lines',
  'created',
  'view_details',
  'send_to_picking',
  'picker',
  'controller',
]

export const DEFAULT_VISIBLE_COLUMNS = [
  'select',
  'order_number',
  'external_id',
  'customer',
  'customer_id',
  'agent',
  'total_amount',
  'status',
  'lines',
  'created',
  'view_details',
  'send_to_picking',
  'picker',
  'controller',
]

export const ORDERS_TABLE_SEARCH_FIELDS = [
  'order_number',
  'external_id',
  'customer',
  'customer_id',
  'agent',
]

const DEFAULT_CONFIG: OrdersTableConfig = {
  visibleColumns: DEFAULT_VISIBLE_COLUMNS,
  columnOrder: ORDERS_TABLE_COLUMN_IDS,
  searchFields: ORDERS_TABLE_SEARCH_FIELDS,
}

const dedupe = (values: string[]) => Array.from(new Set(values))

const ensureSelectColumn = (ids: string[]) =>
  ids.includes('select') ? ids : ['select', ...ids]

const normalizeConfig = (value: OrdersTableConfig | null) => {
  if (!value) return DEFAULT_CONFIG

  const columnOrder = dedupe(
    (Array.isArray(value.columnOrder) ? value.columnOrder : [])
      .filter((id) => ORDERS_TABLE_COLUMN_IDS.includes(id))
  )

  const orderedColumns = ensureSelectColumn([
    ...columnOrder,
    ...ORDERS_TABLE_COLUMN_IDS.filter((id) => !columnOrder.includes(id)),
  ])

  const visibleColumns = dedupe(
    (Array.isArray(value.visibleColumns) ? value.visibleColumns : [])
      .filter((id) => ORDERS_TABLE_COLUMN_IDS.includes(id))
  )

  const finalVisible =
    visibleColumns.length > 0 ? visibleColumns : DEFAULT_VISIBLE_COLUMNS

  return {
    visibleColumns: ensureSelectColumn(finalVisible),
    columnOrder: orderedColumns,
    searchFields: (() => {
      const next = dedupe(
        (Array.isArray(value.searchFields) ? value.searchFields : [])
          .filter((id) => ORDERS_TABLE_SEARCH_FIELDS.includes(id))
      )
      return next.length > 0 ? next : ORDERS_TABLE_SEARCH_FIELDS
    })(),
  }
}

const loadConfig = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    return normalizeConfig(JSON.parse(raw) as OrdersTableConfig)
  } catch {
    return DEFAULT_CONFIG
  }
}

export function useOrdersTableConfig() {
  const [config, setConfig] = useState<OrdersTableConfig>(() => loadConfig())

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }, [config])

  const updateConfig = useCallback((next: OrdersTableConfig) => {
    setConfig(normalizeConfig(next))
  }, [])

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG)
  }, [])

  const value = useMemo(
    () => ({
      config,
      updateConfig,
      resetConfig,
    }),
    [config, resetConfig, updateConfig]
  )

  return value
}
