import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ClipboardList } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { DateInput } from '../../components/DateInput'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import { getCustomerReturnsHistory, type CustomerReturnOut } from '../../services/ordersApi'

const PAGE_SIZE = 20

/** Backend `customer_returns.status` qiymatlari bilan mos (pending/assigned noto‘g‘ri filter berardi). */
const STATUS_OPTIONS = [
  { value: 'pending_controller', label: 'Kutilmoqda (controller)' },
  { value: 'approved', label: 'Tasdiqlangan' },
  { value: 'assigned_to_picker', label: 'Yig‘uvchiga biriktirilgan' },
  { value: 'completed', label: 'Yakunlangan' },
  { value: 'cancelled', label: 'Bekor qilingan' },
] as const

export function ReturnsHistoryPage() {
  const { t } = useTranslation(['admin', 'common'])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(true)
  const { showError } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)
  const loadErrorTitle = "Qaytim tarixini yuklab bo'lmadi"
  const [rows, setRows] = useState<CustomerReturnOut[]>([])
  const [total, setTotal] = useState(0)

  const page = Math.max(0, Math.floor(Number(searchParams.get('offset') ?? 0) / PAGE_SIZE))
  const q = searchParams.get('q') ?? ''
  const status = searchParams.get('status') ?? ''
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''

  const load = useCallback(async () => {
    setIsLoading(true)
    setHasLoadError(false)
    try {
      const data = await getCustomerReturnsHistory({
        q: q || undefined,
        status: status || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      setRows(data.items)
      setTotal(data.total)
    } catch (err) {
      showError(err instanceof Error ? err.message : loadErrorTitle)
      setHasLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }, [dateFrom, dateTo, loadErrorTitle, page, q, showError, status])

  useEffect(() => {
    void load()
  }, [load])

  const rangeText = useMemo(() => {
    if (total === 0) return '0 / 0'
    const start = page * PAGE_SIZE + 1
    const end = Math.min((page + 1) * PAGE_SIZE, total)
    return `${start}-${end} / ${total}`
  }, [page, total])

  return (
    <AdminLayout
      titleSlot={
        <div className="flex items-center gap-2">
          <ClipboardList size={18} />
          <span className="text-sm font-semibold">{t('admin:menu.returns_history')}</span>
        </div>
      }
    >
      <Card className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <input
            type="search"
            value={q}
            onChange={(e) => {
              const value = e.target.value
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev)
                if (value.trim()) next.set('q', value)
                else next.delete('q')
                next.delete('offset')
                return next
              })
            }}
            placeholder="Doc no, mijoz ID yoki mijoz nomi"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
          <select
            value={status}
            onChange={(e) => {
              const value = e.target.value
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev)
                if (value) next.set('status', value)
                else next.delete('status')
                next.delete('offset')
                return next
              })
            }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <option value="">Barcha statuslar</option>
            {STATUS_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <DateInput
            value={dateFrom}
            onChange={(value) =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev)
                if (value.trim()) next.set('date_from', value)
                else next.delete('date_from')
                next.delete('offset')
                return next
              })
            }
            className="w-full"
          />
          <DateInput
            value={dateTo}
            onChange={(value) =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev)
                if (value.trim()) next.set('date_to', value)
                else next.delete('date_to')
                next.delete('offset')
                return next
              })
            }
            className="w-full"
          />
        </div>

        {isLoading ? (
          <div className="relative min-h-[240px]">
            <LoadingOverlay label={t('common:messages.loading')} />
          </div>
        ) : hasLoadError ? (
          <EmptyState
            title={loadErrorTitle}
            actionLabel={t('common:buttons.retry')}
            onAction={() => void load()}
          />
        ) : rows.length === 0 ? (
          <EmptyState title="Qaytim hujjatlari topilmadi" actionLabel={t('common:buttons.refresh')} onAction={() => void load()} />
        ) : (
          <div className="overflow-auto">
            <table className="min-w-[1080px] w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-3 py-2">Doc No</th>
                  <th className="px-3 py-2">Mijoz</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Controller</th>
                  <th className="px-3 py-2">Yig‘uvchi</th>
                  <th className="px-3 py-2">Yuborilgan</th>
                  <th className="px-3 py-2">Yaratilgan</th>
                  <th className="px-3 py-2">Yangilangan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const rowId = getReturnId(item)
                  return (
                    <tr
                      key={rowId || item.doc_no}
                      className={`border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/40 ${
                        rowId ? 'cursor-pointer' : 'cursor-default'
                      }`}
                      onClick={() => {
                        if (!rowId) return
                        navigate(`/admin/returns-history/${rowId}`, {
                          state: { listQuery: searchParams.toString() },
                        })
                      }}
                    >
                    <td className="px-3 py-2 font-semibold text-blue-700 dark:text-blue-300">{item.doc_no}</td>
                    <td className="px-3 py-2">{item.customer_name || item.customer_id || '—'}</td>
                    <td className="px-3 py-2">{item.status}</td>
                    <td className="px-3 py-2">{item.assigned_by_user_name || item.approved_by_user_name || item.assigned_by_user_id || '—'}</td>
                    <td className="px-3 py-2">{item.assigned_picker_user_name || item.assigned_picker_user_id || '—'}</td>
                    <td className="px-3 py-2">{formatDateTime(item.assigned_at)}</td>
                    <td className="px-3 py-2">{formatDateTime(item.created_at)}</td>
                    <td className="px-3 py-2">{formatDateTime(item.updated_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-800">
          <Button variant="outline" onClick={() => void load()}>
            {t('common:buttons.refresh')}
          </Button>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span>{rangeText}</span>
            <Button
              variant="secondary"
              disabled={page === 0}
              onClick={() =>
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  next.set('offset', String((page - 1) * PAGE_SIZE))
                  return next
                })
              }
            >
              {t('common:buttons.back')}
            </Button>
            <Button
              variant="secondary"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() =>
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  next.set('offset', String((page + 1) * PAGE_SIZE))
                  return next
                })
              }
            >
              Keyingi
            </Button>
          </div>
        </div>
      </Card>
    </AdminLayout>
  )
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('uz-UZ')
}

function getReturnId(item: CustomerReturnOut): string {
  const fallback = (item as CustomerReturnOut & { return_id?: string }).return_id
  return String(item.id ?? fallback ?? '').trim()
}
