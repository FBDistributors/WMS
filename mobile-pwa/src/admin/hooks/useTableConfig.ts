import { useCallback, useEffect, useMemo, useState } from 'react'

export type ProductsTableConfig = {
  visibleColumns: string[]
  columnOrder: string[]
  searchFields: string[]
}

const STORAGE_KEY = 'wms_products_table_config'

export const PRODUCTS_TABLE_COLUMN_IDS = [
  'detail',
  'sku',
  'photo',
  'name',
  'category',
  'brand',
  'status',
  'quantity',
  'on_hand_total',
  'available_total',
  'inventory_link',
  'created_by',
  'article_code',
  'barcode',
  'internal_id',
  'manufacturer',
  'group',
  'qty_cases',
  'qty_units',
]

export const DEFAULT_VISIBLE_COLUMNS = [
  'detail',
  'sku',
  'photo',
  'name',
  'category',
  'brand',
  'status',
  'quantity',
  'on_hand_total',
  'available_total',
  'inventory_link',
]

export const PRODUCTS_TABLE_SEARCH_FIELDS = [
  'sku',
  'barcode',
  'name',
  'alt_name',
  'category',
  'group',
]

const DEFAULT_CONFIG: ProductsTableConfig = {
  visibleColumns: DEFAULT_VISIBLE_COLUMNS,
  columnOrder: PRODUCTS_TABLE_COLUMN_IDS,
  searchFields: PRODUCTS_TABLE_SEARCH_FIELDS,
}

const dedupe = (values: string[]) => Array.from(new Set(values))

const normalizeConfig = (value: ProductsTableConfig | null) => {
  if (!value) return DEFAULT_CONFIG

  const columnOrder = dedupe(
    (Array.isArray(value.columnOrder) ? value.columnOrder : [])
      .filter((id) => PRODUCTS_TABLE_COLUMN_IDS.includes(id))
  )

  const orderedColumns = [
    ...columnOrder,
    ...PRODUCTS_TABLE_COLUMN_IDS.filter((id) => !columnOrder.includes(id)),
  ]

  const visibleColumns = dedupe(
    (Array.isArray(value.visibleColumns) ? value.visibleColumns : [])
      .filter((id) => PRODUCTS_TABLE_COLUMN_IDS.includes(id))
  )

  return {
    visibleColumns: visibleColumns.length > 0 ? visibleColumns : DEFAULT_VISIBLE_COLUMNS,
    columnOrder: orderedColumns,
    searchFields: (() => {
      const next = dedupe(
        (Array.isArray(value.searchFields) ? value.searchFields : [])
          .filter((id) => PRODUCTS_TABLE_SEARCH_FIELDS.includes(id))
      )
      return next.length > 0 ? next : PRODUCTS_TABLE_SEARCH_FIELDS
    })(),
  }
}

const loadConfig = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    return normalizeConfig(JSON.parse(raw) as ProductsTableConfig)
  } catch {
    return DEFAULT_CONFIG
  }
}

export function useTableConfig() {
  const [config, setConfig] = useState<ProductsTableConfig>(() => loadConfig())

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }, [config])

  const updateConfig = useCallback((next: ProductsTableConfig) => {
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
