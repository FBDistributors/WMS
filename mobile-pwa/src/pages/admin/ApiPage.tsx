import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Code2, ClipboardList } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { getOrders } from '../../services/ordersApi'

type JsonValue = unknown

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

export function ApiPage() {
  const { t } = useTranslation(['admin', 'common'])
  const [inputValue, setInputValue] = useState('')
  const [orderApiLoading, setOrderApiLoading] = useState(false)
  const [orderApiError, setOrderApiError] = useState<string | null>(null)
  /** B#S tezkor so'rov yuklaganida: nechta buyurtma yuklangan (tekshirish uchun). */
  const [orderApiLoadedCount, setOrderApiLoadedCount] = useState<number | null>(null)

  const fetchOrderApi = useCallback(async () => {
    setOrderApiLoading(true)
    setOrderApiError(null)
    setOrderApiLoadedCount(null)
    const PAGE_SIZE = 500
    const allItems: Record<string, unknown>[] = []
    try {
      let offset = 0
      let hasMore = true
      while (hasMore) {
        const data = await getOrders({
          status: 'B#S',
          limit: PAGE_SIZE,
          offset,
        })
        allItems.push(...(data.items as Record<string, unknown>[]))
        hasMore = data.items.length >= PAGE_SIZE && allItems.length < data.total
        offset += PAGE_SIZE
      }
      setInputValue(JSON.stringify(allItems, null, 2))
      setOrderApiLoadedCount(allItems.length)
    } catch (err) {
      setOrderApiError(err instanceof Error ? err.message : String(err))
    } finally {
      setOrderApiLoading(false)
    }
  }, [])

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

  /** Faqat "bitta qiymat" (array/object emas) bo'lsa pre blokda ko'rsatamiz; array/object textarea da qoladi. */
  const showPre = useMemo(() => {
    if (parsed === null) return false
    if (Array.isArray(parsed) || isRecord(parsed)) return false
    return true
  }, [parsed])

  const clearInput = useCallback(() => {
    setInputValue('')
    setOrderApiLoadedCount(null)
  }, [])

  return (
    <AdminLayout title={t('admin:menu.api', 'API')}>
      <div className="space-y-4">
        <Card className="p-4">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            {t('admin:api.preset_apis', 'Tezkor so‘rovlar')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={fetchOrderApi}
              disabled={orderApiLoading}
              className="shrink-0 px-3 py-2 text-sm"
            >
              <ClipboardList size={16} className="mr-1.5 shrink-0" />
              {orderApiLoading
                ? t('admin:api.loading', 'Yuklanmoqda...')
                : t('admin:api.order_api_btn', 'Order API (B#S, barchasi)')}
            </Button>
          </div>
          {orderApiError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
              {orderApiError}
            </p>
          )}
          {orderApiLoadedCount !== null && !orderApiError && (
            <p className="mt-2 text-sm text-green-600 dark:text-green-400" role="status">
              {t('admin:api.loaded_count', 'Yuklandi: {{count}} ta buyurtma (B#S)', { count: orderApiLoadedCount })}
            </p>
          )}
        </Card>

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
              rows={10}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <Button type="button" variant="outline" onClick={clearInput} className="shrink-0 px-3 py-2 text-sm">
              {t('common:buttons.clear', 'Tozalash')}
            </Button>
          </div>
          {parseError && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
              {parseError}
            </p>
          )}
        </Card>

        {inputValue.trim() === '' && (
          <Card className="flex flex-col items-center justify-center gap-2 p-12 text-center">
            <Code2 size={40} className="text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('admin:api.placeholder_json_only', "Yuqoridagi maydonga JSON yozing yoki «Tezkor so'rovlar» orqali API javobini yuklang.")}
            </p>
          </Card>
        )}

        {showPre && parsed !== null && (
          <Card className="p-4">
            <pre className="overflow-x-auto rounded bg-slate-100 p-3 text-left font-mono text-sm dark:bg-slate-800">
              {JSON.stringify(parsed, null, 2)}
            </pre>
          </Card>
        )}
      </div>
    </AdminLayout>
  )
}
