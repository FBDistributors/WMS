import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import { useAppToast } from '../../../feedback/useAppToast'
import { getPickerUsers, updateOrderStatus, type PickerUser } from '../../../services/ordersApi'

type ReturnPickerDialogProps = {
  open: boolean
  orderId: string
  documentNo: string
  /** Hujjatning hozirgi yig'uvchisi — standart tanlov. */
  currentPickerId?: string | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}

/**
 * Arxivdan "Qaytim (bekor)": buyurtma bekor qilinadi va tanlangan yig'uvchi
 * tovarlarni skanerlab joyiga qaytaradi. Tanlanmasa — hujjatning yig'uvchisi.
 */
export function ReturnPickerDialog({
  open,
  orderId,
  documentNo,
  currentPickerId,
  onOpenChange,
  onDone,
}: ReturnPickerDialogProps) {
  const { t } = useTranslation(['picking', 'orders', 'common'])
  const { showError } = useAppToast()
  const [pickers, setPickers] = useState<PickerUser[]>([])
  const [selected, setSelected] = useState('')
  const [isLoadingPickers, setIsLoadingPickers] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelected(currentPickerId ?? '')
    setIsLoadingPickers(true)
    void (async () => {
      try {
        setPickers(await getPickerUsers())
      } catch {
        showError(t('orders:send_to_picking.load_failed'))
      } finally {
        setIsLoadingPickers(false)
      }
    })()
  }, [open, currentPickerId, showError, t])

  if (!open) return null

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      await updateOrderStatus(orderId, 'cancelled', { returnPickerUserId: selected || null })
      onDone()
      onOpenChange(false)
    } catch {
      showError(t('picking:cancel_error'))
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
            {t('picking:revert_confirm_title')}
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={() => onOpenChange(false)}>
            <X size={18} />
          </Button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('picking:revert_confirm', { doc: documentNo })}
          </p>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('picking:revert_picker_label')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={isLoadingPickers}
            >
              <option value="">
                {isLoadingPickers ? t('common:loading') : t('picking:revert_picker_keep_current')}
              </option>
              {pickers.map((picker) => (
                <option key={String(picker.id)} value={String(picker.id)}>
                  {picker.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common:buttons.cancel')}
            </Button>
            <Button variant="danger" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? t('picking:cancelling') : t('picking:revert_document')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
