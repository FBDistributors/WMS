import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import { getPickerUsers, sendOrderToPicking, type PickerUser } from '../../../services/ordersApi'

type SendToPickingDialogProps = {
  open: boolean
  orderId: string | null
  onOpenChange: (open: boolean) => void
  onSent: () => void
}

export function SendToPickingDialog({ open, orderId, onOpenChange, onSent }: SendToPickingDialogProps) {
  const { t } = useTranslation(['orders', 'common'])
  const [pickers, setPickers] = useState<PickerUser[]>([])
  const [selected, setSelected] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setSelected('')
    void (async () => {
      try {
        const data = await getPickerUsers()
        setPickers(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('orders:send_to_picking.load_failed'))
      }
    })()
  }, [open, t])

  if (!open || !orderId) return null

  const handleSubmit = async () => {
    if (!selected) {
      setError(t('orders:send_to_picking.picker_required'))
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await sendOrderToPicking(orderId, selected)
      onSent()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('orders:send_to_picking.failed'))
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
            {t('orders:send_to_picking.title')}
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
            >
              <option value="">{t('orders:send_to_picking.select_picker')}</option>
              {pickers.map((picker) => (
                <option key={picker.id} value={picker.id}>
                  {picker.name}
                </option>
              ))}
            </select>
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
