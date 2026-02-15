import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import { getPickerUsers, sendOrderToPicking, type PickerUser } from '../../../services/ordersApi'
import type { ApiError } from '../../../services/apiClient'

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function isValidUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_REGEX.test(s)
}

function formatApiError(err: unknown): string {
  if (err && typeof err === 'object' && 'details' in err) {
    const apiErr = err as ApiError
    const d = apiErr.details
    if (d && typeof d === 'object' && 'detail' in d) {
      const detail = d.detail
      if (typeof detail === 'string') return detail
      if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg)
      if (typeof detail === 'object' && detail !== null) {
        const o = detail as Record<string, unknown>
        if (typeof o.msg === 'string') return o.msg
        if (typeof o.message === 'string') return o.message
      }
    }
    if (typeof apiErr.message === 'string') return apiErr.message
  }
  return err instanceof Error ? err.message : 'Error'
}

type SendToPickingDialogProps = {
  open: boolean
  orderIds: string[]
  onOpenChange: (open: boolean) => void
  onSent: () => void
}

export function SendToPickingDialog({ open, orderIds, onOpenChange, onSent }: SendToPickingDialogProps) {
  const { t } = useTranslation(['orders', 'common'])
  const [pickers, setPickers] = useState<PickerUser[]>([])
  const [selected, setSelected] = useState('')
  const [isLoadingPickers, setIsLoadingPickers] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setSelected('')
    setIsLoadingPickers(true)
    void (async () => {
      try {
        const data = await getPickerUsers()
        setPickers(data)
      } catch (err) {
        setError(formatApiError(err) || t('orders:send_to_picking.load_failed'))
      } finally {
        setIsLoadingPickers(false)
      }
    })()
  }, [open, t])

  if (!open || orderIds.length === 0) return null

  const handleSubmit = async () => {
    if (!selected) {
      setError(t('orders:send_to_picking.picker_required'))
      return
    }
    const selectedStr = String(selected).trim()
    if (!isValidUuid(selectedStr)) {
      setError(t('orders:send_to_picking.invalid_selection'))
      return
    }
    const validIds = orderIds.filter((id) => isValidUuid(id))
    if (validIds.length === 0) {
      setError(t('orders:send_to_picking.invalid_selection'))
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      for (const orderIdStr of validIds) {
        await sendOrderToPicking(orderIdStr, selectedStr)
      }
      onSent()
      onOpenChange(false)
    } catch (err) {
      const msg = formatApiError(err) || t('orders:send_to_picking.failed')
      setError(
        msg.toLowerCase().includes('insufficient stock')
          ? t('orders:send_to_picking.insufficient_stock')
          : msg
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-label={t('common:buttons.close')}
        type="button"
      />
      <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {orderIds.length > 1
              ? t('orders:send_selected_to_picking', { count: orderIds.length })
              : t('orders:send_to_picking.title')}
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={() => onOpenChange(false)}>
            <X size={18} />
          </Button>
        </div>
        <div className="space-y-4 px-6 py-5">
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
              {error}
            </div>
          ) : null}
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('orders:send_to_picking.picker')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={isLoadingPickers}
            >
              <option value="">
                {isLoadingPickers ? t('common:loading') : t('orders:send_to_picking.select_picker')}
              </option>
              {pickers
                .filter((p) => isValidUuid(p.id))
                .map((picker) => (
                  <option key={String(picker.id)} value={String(picker.id)}>
                    {picker.name}
                  </option>
                ))}
            </select>
            {!error && !isLoadingPickers && pickers.length === 0 ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {t('orders:send_to_picking.no_pickers_hint')}
              </p>
            ) : null}
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common:buttons.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? t('orders:send_to_picking.sending') : t('orders:send_to_picking.send')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
