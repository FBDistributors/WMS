import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Code2, ClipboardList } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { getSmartupOrderExportRaw } from '../../services/ordersApi'

type JsonValue = unknown

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

export function ApiPage() {
  const { t } = useTranslation(['admin', 'common'])
  const [inputValue, setInputValue] = useState('')
  const [orderApiLoading, setOrderApiLoading] = useState(false)
  const [orderApiError, setOrderApiError] = useState<string | null>(null)
  const [orderApiLoadedCount, setOrderApiLoadedCount] = useState<number | null>(null)
  const [orderApiTotal, setOrderApiTotal] = useState<number | null>(null)
  /** Sync bilan bir xil parametrlar: sana oralig'i va filial. */
  const [smartupBeginDate, setSmartupBeginDate] = useState('')
  const [smartupEndDate, setSmartupEndDate] = useState('')
  const [smartupFilialCode, setSmartupFilialCode] = useState('')
  const [smartupFilialId, setSmartupFilialId] = useState('')

  const fetchOrderApi = useCallback(async () => {
    setOrderApiLoading(true)
    setOrderApiError(null)
    setOrderApiLoadedCount(null)
    setOrderApiTotal(null)
    try {
      const begin = smartupBeginDate.trim() || undefined
      const end = smartupEndDate.trim() || undefined
      const data = await getSmartupOrderExportRaw({
        begin_deal_date: begin,
        end_deal_date: end,
        filial_code: smartupFilialCode.trim() || undefined,
        filial_id: smartupFilialId.trim() || undefined,
      })
      setInputValue(JSON.stringify(data, null, 2))
      const count = data.order?.length ?? 0
      setOrderApiLoadedCount(count)
      setOrderApiTotal(data.total ?? count)
    } catch (err) {
      setOrderApiError(err instanceof Error ? err.message : String(err))
    } finally {
      setOrderApiLoading(false)
    }
  }, [smartupBeginDate, smartupEndDate, smartupFilialCode, smartupFilialId])

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
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            {t('admin:api.smartup_params_hint', "Sync bilan bir xil: sana va filial bo'sh qolsa oxirgi 7 kun ishlatiladi.")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-3">
            <div>
              <label htmlFor="smartup-begin" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                {t('admin:api.begin_deal_date', 'Boshlanish sanasi')}
              </label>
              <input
                id="smartup-begin"
                type="date"
                value={smartupBeginDate}
                onChange={(e) => setSmartupBeginDate(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="smartup-end" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                {t('admin:api.end_deal_date', 'Tugash sanasi')}
              </label>
              <input
                id="smartup-end"
                type="date"
                value={smartupEndDate}
                onChange={(e) => setSmartupEndDate(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="smartup-filial-code" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                {t('admin:api.filial_code', 'Filial kodi')}
              </label>
              <input
                id="smartup-filial-code"
                type="text"
                value={smartupFilialCode}
                onChange={(e) => setSmartupFilialCode(e.target.value)}
                placeholder=""
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="smartup-filial-id" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                {t('admin:api.filial_id', 'Filial ID')}
              </label>
              <input
                id="smartup-filial-id"
                type="text"
                value={smartupFilialId}
                onChange={(e) => setSmartupFilialId(e.target.value)}
                placeholder=""
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>
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
                : t('admin:api.order_api_smartup_btn', 'SmartUp dan Order API (B#S)')}
            </Button>
          </div>
          {orderApiError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
              {orderApiError}
            </p>
          )}
          {orderApiLoadedCount !== null && !orderApiError && (
            <p className="mt-2 text-sm text-green-600 dark:text-green-400" role="status">
              {orderApiTotal !== null && orderApiTotal !== orderApiLoadedCount
                ? t('admin:api.loaded_from_smartup_total', 'SmartUp dan yuklandi: {{count}} / {{total}} ta buyurtma (B#S)', {
                    count: orderApiLoadedCount,
                    total: orderApiTotal,
                  })
                : t('admin:api.loaded_from_smartup', 'SmartUp dan yuklandi: {{count}} ta buyurtma (B#S)', {
                    count: orderApiLoadedCount,
                  })}
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
