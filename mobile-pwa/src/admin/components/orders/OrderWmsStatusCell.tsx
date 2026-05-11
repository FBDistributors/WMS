import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { getControllerUsers, updateOrderStatus, type ControllerUser } from '../../../services/ordersApi'

/** Dropdown qiymatlari — PATCH body `status` bilan mos (OrdersPage bilan bir xil). */
export const SIMPLE_STATUS_OPTIONS = [
  { value: 'picking', labelKey: 'orders:status_simple.yigishda' },
  { value: 'picked', labelKey: 'orders:status_simple.tekshiruvda' },
  { value: 'completed', labelKey: 'orders:status_simple.yakunlash' },
  { value: 'cancelled', labelKey: 'orders:status_simple.cancelled' },
] as const

export type SimpleOrderStatus = (typeof SIMPLE_STATUS_OPTIONS)[number]['value']

export function backendStatusToSimple(status: string): SimpleOrderStatus {
  if (status === 'cancelled') return 'cancelled'
  if (['imported', 'allocated', 'picking'].includes(status)) return 'picking'
  if (status === 'picked') return 'picked'
  return 'completed'
}

type OrderWmsStatusCellProps = {
  orderId: string
  orderNumber: string
  /** Backend buyurtma WMS statusi (`order.status`). */
  status: string
  canEdit: boolean
  onAfterSave: () => void | Promise<void>
}

export function OrderWmsStatusCell({ orderId, orderNumber, status, canEdit, onAfterSave }: OrderWmsStatusCellProps) {
  const { t } = useTranslation(['orders', 'common'])
  const [isUpdating, setIsUpdating] = useState(false)
  const [controllerModalOpen, setControllerModalOpen] = useState(false)
  const [controllers, setControllers] = useState<ControllerUser[]>([])
  const [controllerModalLoading, setControllerModalLoading] = useState(false)
  const [selectedControllerId, setSelectedControllerId] = useState('')
  const [controllerModalSubmitting, setControllerModalSubmitting] = useState(false)

  const runAfterSave = useCallback(async () => {
    await onAfterSave()
  }, [onAfterSave])

  if (!canEdit) {
    return <td className="px-4 py-3 text-slate-400 dark:text-slate-600">—</td>
  }

  const simpleValue = backendStatusToSimple(status)

  const modal =
    controllerModalOpen &&
    createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
        <button
          type="button"
          className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
          onClick={() => !controllerModalSubmitting && setControllerModalOpen(false)}
          aria-label={t('common:buttons.close')}
        />
        <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('orders:controller_modal.title')}
            </div>
            <Button
              variant="ghost"
              className="rounded-full px-3 py-3"
              onClick={() => !controllerModalSubmitting && setControllerModalOpen(false)}
            >
              <X size={18} />
            </Button>
          </div>
          <div className="space-y-4 px-6 py-5">
            <p className="text-sm text-slate-600 dark:text-slate-300">{orderNumber}</p>
            <label className="block text-sm text-slate-600 dark:text-slate-300">
              {t('orders:controller_modal.controller_label')}
              <select
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={selectedControllerId}
                onChange={(e) => setSelectedControllerId(e.target.value)}
                disabled={controllerModalLoading}
              >
                <option value="">
                  {controllerModalLoading
                    ? t('orders:controller_modal.loading')
                    : t('orders:controller_modal.controller_skip')}
                </option>
                {controllers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setControllerModalOpen(false)}
                disabled={controllerModalSubmitting}
              >
                {t('common:buttons.cancel')}
              </Button>
              <Button
                disabled={controllerModalSubmitting}
                onClick={async () => {
                  setControllerModalSubmitting(true)
                  try {
                    await updateOrderStatus(orderId, 'picked', selectedControllerId.trim() || undefined)
                    setControllerModalOpen(false)
                    await runAfterSave()
                  } finally {
                    setControllerModalSubmitting(false)
                  }
                }}
              >
                {controllerModalSubmitting ? t('common:loading') : t('orders:controller_modal.confirm')}
              </Button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    )

  return (
    <>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <select
          value={simpleValue}
          disabled={isUpdating}
          onChange={async (e) => {
            const newSimple = e.target.value as SimpleOrderStatus
            const backendStatus = newSimple
            if (backendStatus === status) return
            if (backendStatus === 'cancelled') {
              const ok = window.confirm(t('orders:confirm_cancel_order'))
              if (!ok) return
            }
            if (backendStatus === 'picked') {
              setControllerModalOpen(true)
              setSelectedControllerId('')
              setControllerModalLoading(true)
              try {
                const list = await getControllerUsers()
                setControllers(list)
              } catch {
                setControllers([])
              } finally {
                setControllerModalLoading(false)
              }
              return
            }
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
      {modal}
    </>
  )
}
