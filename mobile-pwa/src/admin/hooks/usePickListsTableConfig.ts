import { useCallback, useEffect, useMemo, useState } from 'react'

export type PickListsTableConfig = {
  visibleColumns: string[]
  columnOrder: string[]
}

const STORAGE_KEYS: Record<string, string> = {
  active: 'wms_picklists_table_config',
  cancelled: 'wms_picklists_cancelled_table_config_v2',
  archive: 'wms_picklists_archive_table_config',
}

export const PICKLISTS_COLUMN_IDS = [
  'document_no',
  'delivery_number',
  'customer_id',
  'customer_name',
  'pipeline_status',
  'doc_status',
  'total_lines',
  'picker',
  'controller',
  'last_activity',
  'sent_to_picker_at',
  'picker_reassigned_at',
  'cancelled_at',
  'cancelled_by',
  'view',
  'cancel',
]

export const DEFAULT_VISIBLE_ACTIVE: string[] = [
  'document_no',
  'delivery_number',
  'customer_id',
  'customer_name',
  'pipeline_status',
  'doc_status',
  'total_lines',
  'picker',
  'controller',
  'last_activity',
  'view',
  'cancel',
]

export const DEFAULT_VISIBLE_ARCHIVE: string[] = [
  'document_no',
  'customer_id',
  'customer_name',
  'pipeline_status',
  'doc_status',
  'total_lines',
  'picker',
  'controller',
  'last_activity',
  'view',
]

export const DEFAULT_VISIBLE_CANCELLED: string[] = [
  'document_no',
  'pipeline_status',
  'doc_status',
  'total_lines',
  'picker',
  'sent_to_picker_at',
  'picker_reassigned_at',
  'cancelled_by',
  'cancelled_at',
  'view',
]

const dedupe = (values: string[]) => Array.from(new Set(values))

function makeDefault(visible: string[]): PickListsTableConfig {
  return { visibleColumns: visible, columnOrder: PICKLISTS_COLUMN_IDS }
}

function normalize(value: PickListsTableConfig | null, defaultVisible: string[]): PickListsTableConfig {
  if (!value) return makeDefault(defaultVisible)

  const columnOrder = dedupe(
    (Array.isArray(value.columnOrder) ? value.columnOrder : []).filter((id) =>
      PICKLISTS_COLUMN_IDS.includes(id)
    )
  )
  const ordered = [...columnOrder, ...PICKLISTS_COLUMN_IDS.filter((id) => !columnOrder.includes(id))]

  const visibleColumns = dedupe(
    (Array.isArray(value.visibleColumns) ? value.visibleColumns : []).filter((id) =>
      PICKLISTS_COLUMN_IDS.includes(id)
    )
  )

  return {
    visibleColumns: visibleColumns.length > 0 ? visibleColumns : defaultVisible,
    columnOrder: ordered,
  }
}

function loadConfig(key: string, defaultVisible: string[]): PickListsTableConfig {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return makeDefault(defaultVisible)
    return normalize(JSON.parse(raw) as PickListsTableConfig, defaultVisible)
  } catch {
    return makeDefault(defaultVisible)
  }
}

export function usePickListsTableConfig(scope: 'active' | 'cancelled' | 'archive') {
  const storageKey = STORAGE_KEYS[scope]
  const defaultVisible =
    scope === 'archive'
      ? DEFAULT_VISIBLE_ARCHIVE
      : scope === 'cancelled'
        ? DEFAULT_VISIBLE_CANCELLED
        : DEFAULT_VISIBLE_ACTIVE

  const [config, setConfig] = useState<PickListsTableConfig>(() => loadConfig(storageKey, defaultVisible))

  useEffect(() => {
    setConfig(loadConfig(storageKey, defaultVisible))
  }, [storageKey, defaultVisible])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(config))
  }, [config, storageKey])

  const updateConfig = useCallback(
    (next: PickListsTableConfig) => setConfig(normalize(next, defaultVisible)),
    [defaultVisible]
  )

  const resetConfig = useCallback(() => setConfig(makeDefault(defaultVisible)), [defaultVisible])

  return useMemo(() => ({ config, updateConfig, resetConfig }), [config, updateConfig, resetConfig])
}
