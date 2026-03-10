import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { InventoryHeaderTabs } from '../../admin/components/inventory/InventoryHeaderTabs'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getSmartupBalance } from '../../services/inventoryApi'

/** API javobidan jadval uchun qatorlar ro'yxatini ajratib oladi. */
function normalizeToRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
  }
  if (data != null && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const key of ['balance', 'items', 'export', 'data', 'movement']) {
      const val = obj[key]
      if (Array.isArray(val)) {
        return val.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
      }
    }
  }
  return []
}

/** Birinchi qatordagi barcha key larni ustunlar sifatida qaytaradi. */
function getColumns(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return []
  const first = rows[0]
  return Object.keys(first).filter((k) => first[k] !== undefined && first[k] !== null)
}

export function SmartupBalancePage() {
  const { t } = useTranslation(['inventory', 'common'])
  const [data, setData] = useState<unknown>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await getSmartupBalance()
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => normalizeToRows(data), [data])
  const columns = useMemo(() => getColumns(rows), [rows])

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return (
        <EmptyState
          title={error}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      )
    }
    if (rows.length === 0) {
      return (
        <EmptyState
          title={t('inventory:empty')}
          description={t('inventory:smartup_balance_table_hint')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    return (
      <TableScrollArea inline>
        <table className="w-max min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {columns.map((col) => (
                <th key={col} className="whitespace-nowrap px-3 py-3 text-left">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={idx}
                className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
              >
                {columns.map((col) => (
                  <td key={col} className="whitespace-nowrap px-3 py-3 text-slate-700 dark:text-slate-200">
                    {row[col] != null ? String(row[col]) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [columns, error, isLoading, load, rows, t])

  return (
    <AdminLayout titleSlot={<InventoryHeaderTabs />}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('inventory:smartup_balance_table_hint')}
          </p>
          <div className="flex items-center gap-2">
            <Link to="/admin/inventory">
              <Button variant="secondary">{t('inventory:back_to_summary')}</Button>
            </Link>
            <Button variant="secondary" onClick={load} disabled={isLoading}>
              {t('common:buttons.refresh')}
            </Button>
          </div>
        </div>
        <div className="max-h-[calc(100vh-320px)] min-h-0 overflow-auto">{content}</div>
      </Card>
    </AdminLayout>
  )
}
