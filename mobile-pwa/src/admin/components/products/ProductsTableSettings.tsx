import { useCallback, useEffect, useMemo, useState } from 'react'
import { GripVertical, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import type { ProductsTableConfig } from '../../hooks/useTableConfig'

type Option = {
  id: string
  label: string
}

type ProductsTableSettingsProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: ProductsTableConfig
  columns: Option[]
  searchFields: Option[]
  onSave: (config: ProductsTableConfig) => void
  onReset: () => void
}

const reorder = (list: string[], fromId: string, toId: string) => {
  const from = list.indexOf(fromId)
  const to = list.indexOf(toId)
  if (from === -1 || to === -1 || from === to) return list
  const next = [...list]
  next.splice(from, 1)
  next.splice(to, 0, fromId)
  return next
}

export function ProductsTableSettings({
  open,
  onOpenChange,
  config,
  columns,
  searchFields,
  onSave,
  onReset,
}: ProductsTableSettingsProps) {
  const { t } = useTranslation(['products', 'common'])
  const [localColumns, setLocalColumns] = useState<string[]>(config.columnOrder)
  const [visibleColumns, setVisibleColumns] = useState<string[]>(config.visibleColumns)
  const [localSearchFields, setLocalSearchFields] = useState<string[]>(config.searchFields)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLocalColumns(config.columnOrder)
    setVisibleColumns(config.visibleColumns)
    setLocalSearchFields(config.searchFields)
  }, [config, open])

  const toggleVisible = useCallback((id: string) => {
    setVisibleColumns((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }, [])

  const toggleSearchField = useCallback((id: string) => {
    setLocalSearchFields((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }, [])

  const orderedColumns = useMemo(
    () => localColumns.filter((id) => columns.some((column) => column.id === id)),
    [columns, localColumns]
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-label={t('common:buttons.close')}
        type="button"
      />
      <div className="relative ml-auto flex h-full w-full max-w-[520px] flex-col bg-white shadow-2xl dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('products:table.settings_title')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('products:table.columns_hint')}
            </p>
          </div>
          <Button
            variant="ghost"
            className="rounded-full px-3 py-3"
            onClick={() => onOpenChange(false)}
          >
            <X size={18} />
          </Button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('products:table.columns_title')}
            </h3>
            <div className="mt-3 space-y-2">
              {orderedColumns.map((id) => {
                const column = columns.find((item) => item.id === id)
                if (!column) return null
                return (
                  <div
                    key={column.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', column.id)
                      setDraggingId(column.id)
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      const droppedId = event.dataTransfer.getData('text/plain')
                      setLocalColumns((prev) => reorder(prev, droppedId, column.id))
                    }}
                    className={`flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 shadow-sm transition dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 ${
                      draggingId === column.id ? 'ring-2 ring-blue-500' : ''
                    }`}
                  >
                    <GripVertical size={16} className="text-slate-400" />
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={visibleColumns.includes(column.id)}
                      onChange={() => toggleVisible(column.id)}
                    />
                    <span className="flex-1">{column.label}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('products:table.search_title')}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('products:table.search_hint')}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {searchFields.map((field) => (
                <label
                  key={field.id}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={localSearchFields.includes(field.id)}
                    onChange={() => toggleSearchField(field.id)}
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </section>
        </div>

        <div className="border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                onReset()
                onOpenChange(false)
              }}
            >
              {t('products:table.reset_default')}
            </Button>
            <Button
              onClick={() => {
                onSave({
                  visibleColumns,
                  columnOrder: localColumns,
                  searchFields: localSearchFields,
                })
                onOpenChange(false)
              }}
            >
              {t('products:table.save_settings')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
