import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import { EmptyState } from '../../../components/ui/EmptyState'
import { LoadingOverlay } from '../../../components/ui/LoadingOverlay'
import { formatDuration } from '../../../lib/formatDuration'
import {
  getStaffOrders,
  type StaffGroup,
  type StaffOrderRow,
  type StaffRole,
} from '../../../services/dashboardApi'

export type StaffSelection = {
  userId: string
  name: string
  role: StaffRole
  group: StaffGroup
}

type StaffOrdersDialogProps = {
  staff: StaffSelection | null
  dateFrom?: string
  dateTo?: string
  onClose: () => void
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatQty(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

export function StaffOrdersDialog({ staff, dateFrom, dateTo, onClose }: StaffOrdersDialogProps) {
  const { t } = useTranslation(['admin', 'common'])
  const navigate = useNavigate()
  const [rows, setRows] = useState<StaffOrderRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    if (!staff) return
    let cancelled = false
    setIsLoading(true)
    setHasError(false)
    void (async () => {
      try {
        const data = await getStaffOrders({
          userId: staff.userId,
          role: staff.role,
          group: staff.group,
          dateFrom,
          dateTo,
        })
        if (!cancelled) setRows(data)
      } catch {
        if (!cancelled) setHasError(true)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [staff, dateFrom, dateTo])

  if (!staff) return null

  const totalQty = rows.reduce((sum, r) => sum + r.picked_qty, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label={t('common:buttons.close')}
        type="button"
      />
      <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{staff.name}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t(`admin:dashboard.staff_orders.role_${staff.role}`)}
              {dateFrom || dateTo ? ` · ${dateFrom || '…'} – ${dateTo || '…'}` : ''}
              {!isLoading && rows.length > 0
                ? ` · ${t('admin:dashboard.staff_orders.orders_count', { count: rows.length })} · ${t('admin:dashboard.staff_orders.total_qty', { qty: formatQty(totalQty) })}`
                : ''}
            </div>
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>

        <div className="relative min-h-[200px] flex-1 overflow-auto px-6 py-4">
          {isLoading ? (
            <div className="relative min-h-[200px]">
              <LoadingOverlay label={t('common:messages.loading')} />
            </div>
          ) : hasError ? (
            <EmptyState title={t('admin:dashboard.staff_orders.load_error')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('admin:dashboard.staff_orders.empty')} />
          ) : (
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-3 py-2.5">{t('admin:dashboard.staff_orders.col_order')}</th>
                  <th className="px-3 py-2.5">{t('admin:dashboard.staff_orders.col_customer')}</th>
                  <th className="px-3 py-2.5">{t('admin:dashboard.staff_orders.col_document')}</th>
                  <th className="px-3 py-2.5">{t('admin:dashboard.staff_orders.col_status')}</th>
                  <th className="px-3 py-2.5 text-right">{t('admin:dashboard.staff_orders.col_qty')}</th>
                  <th className="px-3 py-2.5 text-right">{t('admin:dashboard.staff_orders.col_lines')}</th>
                  <th className="px-3 py-2.5 text-right">
                    {t(
                      staff.role === 'picker'
                        ? 'admin:dashboard.staff_orders.col_pick_time'
                        : 'admin:dashboard.staff_orders.col_check_time'
                    )}
                  </th>
                  <th className="px-3 py-2.5">{t('admin:dashboard.staff_orders.col_arrived')}</th>
                  <th className="px-3 py-2.5">{t('admin:dashboard.staff_orders.col_finished')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const clickable = Boolean(r.order_id)
                  const arrivedAt =
                    staff.role === 'picker' ? r.first_assigned_at : r.sent_to_controller_at
                  const finishedAt =
                    staff.role === 'picker'
                      ? r.sent_to_controller_at ?? r.completed_at
                      : r.completed_at
                  return (
                    <tr
                      key={r.document_id}
                      onClick={clickable ? () => navigate(`/admin/orders/${r.order_id}`) : undefined}
                      className={`border-b border-slate-50 dark:border-slate-800/60 ${
                        clickable
                          ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          : ''
                      }`}
                    >
                      <td className="px-3 py-2.5 font-medium text-blue-700 dark:text-blue-300">
                        {r.order_number ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 dark:text-slate-200">
                        <span className="block max-w-[16rem] truncate" title={r.customer_name ?? undefined}>
                          {r.customer_name ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">{r.document_no}</td>
                      <td className="px-3 py-2.5">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {formatQty(r.picked_qty)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-200">
                        {r.lines_count}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-200">
                        {formatDuration(
                          staff.role === 'picker' ? r.pick_seconds : r.control_total_seconds,
                          {
                            h: t('admin:dashboard.timing.h'),
                            m: t('admin:dashboard.timing.m'),
                            s: t('admin:dashboard.timing.s'),
                          }
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 dark:text-slate-400">
                        {formatDateTime(arrivedAt)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 dark:text-slate-400">
                        {formatDateTime(finishedAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
