import { useCallback, useEffect, useMemo, useState } from 'react'

export type MovementsTableConfig = {
  visibleColumns: string[]
  columnOrder: string[]
  searchFields: string[]
}

const dedupe = (values: string[]) => Array.from(new Set(values))

const ensureSelectColumn = (ids: string[], hasSelect: boolean) =>
  hasSelect && ids.includes('select') ? ids : hasSelect && !ids.includes('select') ? ['select', ...ids] : ids

function createMovementsTableConfig(
  storageKey: string,
  columnIds: string[],
  searchFieldIds: string[]
) {
  const hasSelect = columnIds.includes('select')
  const defaultConfig: MovementsTableConfig = {
    visibleColumns: columnIds,
    columnOrder: columnIds,
    searchFields: searchFieldIds,
  }

  const normalizeConfig = (value: MovementsTableConfig | null): MovementsTableConfig => {
    if (!value) return defaultConfig

    const columnOrder = dedupe(
      (Array.isArray(value.columnOrder) ? value.columnOrder : []).filter((id) => columnIds.includes(id))
    )
    const orderedColumns = ensureSelectColumn(
      [...columnOrder, ...columnIds.filter((id) => !columnOrder.includes(id))],
      hasSelect
    )

    const visibleColumns = dedupe(
      (Array.isArray(value.visibleColumns) ? value.visibleColumns : []).filter((id) => columnIds.includes(id))
    )
    const finalVisible = visibleColumns.length > 0 ? visibleColumns : columnIds

    const searchFields = dedupe(
      (Array.isArray(value.searchFields) ? value.searchFields : []).filter((id) => searchFieldIds.includes(id))
    )

    return {
      visibleColumns: ensureSelectColumn(finalVisible, hasSelect),
      columnOrder: orderedColumns,
      searchFields: searchFields.length > 0 ? searchFields : searchFieldIds,
    }
  }

  const loadConfig = (): MovementsTableConfig => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return defaultConfig
      return normalizeConfig(JSON.parse(raw) as MovementsTableConfig)
    } catch {
      return defaultConfig
    }
  }

  return { defaultConfig, normalizeConfig, loadConfig }
}

export function useDillerTableConfig() {
  const DILLER_COLUMN_IDS = [
    'select',
    'order_number',
    'external_id',
    'from_warehouse_code',
    'to_warehouse_code',
    'movement_note',
    'total_amount',
    'status',
    'lines',
    'delivery_date',
    'view_details',
  ]
  const DILLER_SEARCH_FIELDS = [
    'order_number',
    'external_id',
    'from_warehouse_code',
    'to_warehouse_code',
    'movement_note',
    'status',
  ]
  const { defaultConfig, normalizeConfig, loadConfig } = createMovementsTableConfig(
    'wms_diller_table_config',
    DILLER_COLUMN_IDS,
    DILLER_SEARCH_FIELDS
  )

  const [config, setConfig] = useState<MovementsTableConfig>(() => loadConfig())

  useEffect(() => {
    localStorage.setItem('wms_diller_table_config', JSON.stringify(config))
  }, [config])

  const updateConfig = useCallback(
    (next: MovementsTableConfig) => setConfig(normalizeConfig(next)),
    [normalizeConfig]
  )
  const resetConfig = useCallback(() => setConfig(defaultConfig), [defaultConfig])

  return useMemo(
    () => ({ config, updateConfig, resetConfig }),
    [config, updateConfig, resetConfig]
  )
}

export function useOrikzorTableConfig() {
  const ORIKZOR_COLUMN_IDS = [
    'select',
    'movement_number',
    'movement_note',
    'status',
    'lines',
    'delivery_date',
    'view_details',
  ]
  const ORIKZOR_SEARCH_FIELDS = ['movement_number', 'movement_note', 'status']
  const { defaultConfig, normalizeConfig, loadConfig } = createMovementsTableConfig(
    'wms_orikzor_table_config',
    ORIKZOR_COLUMN_IDS,
    ORIKZOR_SEARCH_FIELDS
  )

  const [config, setConfig] = useState<MovementsTableConfig>(() => loadConfig())

  useEffect(() => {
    localStorage.setItem('wms_orikzor_table_config', JSON.stringify(config))
  }, [config])

  const updateConfig = useCallback(
    (next: MovementsTableConfig) => setConfig(normalizeConfig(next)),
    [normalizeConfig]
  )
  const resetConfig = useCallback(() => setConfig(defaultConfig), [defaultConfig])

  return useMemo(
    () => ({ config, updateConfig, resetConfig }),
    [config, updateConfig, resetConfig]
  )
}
