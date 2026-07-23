import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { updateOrderStatus } from '../../../services/ordersApi'

/** Dropdown qiymatlari — PATCH body `status` bilan mos (OrdersPage bilan bir xil). */
export const SIMPLE_STATUS_OPTIONS = [
  { value: 'picking', labelKey: 'orders:status_simple.yigishda' },
  { value: 'picked', labelKey: 'orders:status_simple.tekshiruvda' },
  { value: 'completed', labelKey: 'orders:status_simple.yakunlash' },
] as const

export type SimpleOrderStatus = (typeof SIMPLE_STATUS_OPTIONS)[number]['value']

export function backendStatusToSimple(status: string): SimpleOrderStatus {
  if (['imported', 'W', 'allocated', 'picking', 'cancelling_in_progress', 'cancelled'].includes(status)) return 'picking'
  if (status === 'picked') return 'picked'
  return 'completed'
}

type OrderWmsStatusCellProps = {
  orderId: string
  /** Backend buyurtma WMS statusi (`order.status`). */
  status: string
  canEdit: boolean
  onAfterSave: () => void | Promise<void>
}

/**
 * Statusni o'zgartirish katakchasi.
 *
 * "Tekshiruvda" (picked) tanlansa controller tanlanmaydi — hujjat umumiy tekshiruv
 * navbatiga tushadi va uni istalgan kontrolyor o'zi band qiladi.
 */
export function OrderWmsStatusCell({ orderId, status, canEdit, onAfterSave }: OrderWmsStatusCellProps) {
  const { t } = useTranslation(['orders', 'common'])
  const [isUpdating, setIsUpdating] = useState(false)

  const runAfterSave = useCallback(async () => {
    await onAfterSave()
  }, [onAfterSave])

  if (!canEdit) {
    return <td className="px-4 py-3 text-slate-400 dark:text-slate-600">—</td>
  }

  const simpleValue = backendStatusToSimple(status)

  return (
    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
      <select
        value={simpleValue}
        disabled={isUpdating}
        onChange={async (e) => {
          const backendStatus = e.target.value as SimpleOrderStatus
          if (backendStatus === status) return
          setIsUpdating(true)
          try {
            await updateOrderStatus(orderId, backendStatus)
            await runAfterSave()
          } finally {
            setIsUpdating(false)
          }
        }}
        className="min-w-[140px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 disabled:opacity-60"
        aria-label={t('orders:columns.change_status')}
      >
        {SIMPLE_STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {t(s.labelKey)}
          </option>
        ))}
      </select>
    </td>
  )
}
