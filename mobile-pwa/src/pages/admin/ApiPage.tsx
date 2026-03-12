import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Code2 } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'

type JsonValue = unknown

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

function isArrayOfRecords(x: unknown): x is Record<string, unknown>[] {
  return Array.isArray(x) && (x.length === 0 || x.every(isRecord))
}

/** Bir qator (obyekt) dan barcha key larni yig'adi; ichki obyektlar stringify. */
function collectKeys(rows: Record<string, unknown>[]): string[] {
  const set = new Set<string>()
  for (const row of rows) {
    for (const k of Object.keys(row)) set.add(k)
  }
  return Array.from(set)
}

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

export function ApiPage() {
  const { t } = useTranslation(['admin', 'common'])
  const [inputValue, setInputValue] = useState('')

  const { parsed, parseError } = useMemo(() => {
    const s = inputValue.trim()
    if (!s) return { parsed: null, parseError: null as string | null }
    try {
      const data = JSON.parse(s) as JsonValue
      return { parsed: data, parseError: null }
    } catch (e) {
      return { parsed: null, parseError: e instanceof Error ? e.message : 'Invalid JSON' }
    }
  }, [inputValue])

  const tableData = useMemo(() => {
    if (parsed === null) return { type: 'empty' as const }
    if (isArrayOfRecords(parsed)) {
      const keys = collectKeys(parsed)
      return { type: 'array' as const, rows: parsed, keys }
    }
    if (isRecord(parsed)) {
      const keys = Object.keys(parsed)
      return { type: 'object' as const, rows: [parsed], keys }
    }
    return { type: 'single' as const, value: parsed }
  }, [parsed])

  const clearInput = useCallback(() => setInputValue(''), [])

  return (
    <AdminLayout title={t('admin:menu.api', 'API')}>
      <div className="space-y-4">
        <Card className="p-4">
          <label htmlFor="api-input" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('admin:api.input_label', "API ma'lumotlari (JSON)")}
          </label>
          <div className="mt-2 flex gap-2">
            <textarea
              id="api-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder='{"key": "value"} yoki [{"a": 1}, {"a": 2}]'
              rows={3}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <Button type="button" variant="outline" size="sm" onClick={clearInput} className="shrink-0">
              {t('common:buttons.clear', 'Tozalash')}
            </Button>
          </div>
          {parseError && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
              {parseError}
            </p>
          )}
        </Card>

        {tableData.type === 'empty' && inputValue.trim() === '' && (
          <Card className="flex flex-col items-center justify-center gap-2 p-12 text-center">
            <Code2 size={40} className="text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('admin:api.placeholder', "Yuqoridagi maydonga JSON yozing yoki API javobini joylashtiring — jadval shu yerda ko'rinadi.")}
            </p>
          </Card>
        )}

        {tableData.type === 'single' && (
          <Card className="p-4">
            <pre className="overflow-x-auto rounded bg-slate-100 p-3 text-left font-mono text-sm dark:bg-slate-800">
              {JSON.stringify(tableData.value, null, 2)}
            </pre>
          </Card>
        )}

        {(tableData.type === 'array' || tableData.type === 'object') && (
          <Card className="overflow-hidden p-0">
            <TableScrollArea>
              <table className="w-full min-w-[600px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                    <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">#</th>
                    {tableData.keys.map((key) => (
                      <th key={key} className="whitespace-nowrap px-3 py-2 font-medium text-slate-600 dark:text-slate-300">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.rows.map((row, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/30"
                    >
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{idx + 1}</td>
                      {tableData.keys.map((key) => (
                        <td key={key} className="max-w-[320px] truncate px-3 py-2 font-mono text-xs" title={cellValue(row[key])}>
                          {cellValue(row[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollArea>
          </Card>
        )}
      </div>
    </AdminLayout>
  )
}
