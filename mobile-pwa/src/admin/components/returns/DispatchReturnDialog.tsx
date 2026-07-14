import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import { useAppToast } from '../../../feedback/useAppToast'
import { getPickerUsers, type PickerUser } from '../../../services/ordersApi'
import { dispatchSmartupReturn } from '../../../services/smartupReturnsApi'
import type { ApiError } from '../../../services/apiClient'

type UnmappedItem = { product_code: string | null; product_name: string | null; reason: string }

function parseUnmapped(err: unknown): UnmappedItem[] | null {
  if (!err || typeof err !== 'object' || !('details' in err)) return null
  const details = (err as ApiError).details
  if (!details || typeof details !== 'object') return null
  const detail = (details as { detail?: unknown }).detail
  if (!detail || typeof detail !== 'object') return null
  const o = detail as Record<string, unknown>
  if (o.code !== 'UNMAPPED_PRODUCTS' || !Array.isArray(o.items)) return null
  return (o.items as Record<string, unknown>[]).map((it) => ({
    product_code: (it.product_code as string) ?? null,
    product_name: (it.product_name as string) ?? null,
    reason: String(it.reason ?? ''),
  }))
}

type DispatchReturnDialogProps = {
  open: boolean
  returnId: string | null
  onOpenChange: (open: boolean) => void
  onDispatched: () => void
}

export function DispatchReturnDialog({
  open,
  returnId,
  onOpenChange,
  onDispatched,
}: DispatchReturnDialogProps) {
  const { t } = useTranslation(['admin', 'common'])
  const { showSuccess, showError } = useAppToast()
  const [pickers, setPickers] = useState<PickerUser[]>([])
  const [selected, setSelected] = useState('')
  const [isLoadingPickers, setIsLoadingPickers] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [unmapped, setUnmapped] = useState<UnmappedItem[] | null>(null)

  useEffect(() => {
    if (!open) {
      setUnmapped(null)
      return
    }
    setValidationError(null)
    setSelected('')
    setUnmapped(null)
    setIsLoadingPickers(true)
    void (async () => {
      try {
        setPickers(await getPickerUsers())
      } catch {
        showError(t('admin:smartupReturns.dispatch.load_pickers_failed'))
      } finally {
        setIsLoadingPickers(false)
      }
    })()
  }, [open, showError, t])

  if (!open || !returnId) return null

  const reasonLabel = (reason: string): string =>
    reason === 'bad_qty'
      ? t('admin:smartupReturns.dispatch.reason_bad_qty')
      : t('admin:smartupReturns.dispatch.reason_not_found')

  const handleSubmit = async () => {
    if (!selected) {
      setValidationError(t('admin:smartupReturns.dispatch.picker_required'))
      return
    }
    setIsSubmitting(true)
    setValidationError(null)
    setUnmapped(null)
    try {
      await dispatchSmartupReturn(returnId, selected)
      showSuccess(t('admin:smartupReturns.dispatch.success'))
      onDispatched()
      onOpenChange(false)
    } catch (err) {
      const items = parseUnmapped(err)
      if (items && items.length > 0) {
        setUnmapped(items)
      } else {
        showError(
          (err as ApiError)?.message || t('admin:smartupReturns.dispatch.failed'),
        )
      }
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
            {t('admin:smartupReturns.dispatch.title')}
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={() => onOpenChange(false)}>
            <X size={18} />
          </Button>
        </div>
        <div className="space-y-4 px-6 py-5">
          {validationError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
              {validationError}
            </div>
          ) : null}

          {unmapped ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
              <div className="mb-2 font-medium text-amber-800 dark:text-amber-300">
                {t('admin:smartupReturns.dispatch.unmapped_intro')}
              </div>
              <ul className="space-y-1 text-amber-800 dark:text-amber-200">
                {unmapped.map((it, i) => (
                  <li key={i} className="flex items-start justify-between gap-2">
                    <span>{it.product_name || it.product_code || '—'}</span>
                    <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                      {it.product_code ? `${it.product_code} · ` : ''}
                      {reasonLabel(it.reason)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <label className="block text-sm text-slate-600 dark:text-slate-300">
            {t('admin:smartupReturns.dispatch.picker_label')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={isLoadingPickers}
            >
              <option value="">
                {isLoadingPickers
                  ? t('common:messages.loading')
                  : t('admin:smartupReturns.dispatch.select_picker')}
              </option>
              {pickers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {!isLoadingPickers && pickers.length === 0 ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {t('admin:smartupReturns.dispatch.no_pickers')}
              </p>
            ) : null}
          </label>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common:buttons.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || isLoadingPickers}>
              {isSubmitting
                ? t('admin:smartupReturns.dispatch.sending')
                : t('admin:smartupReturns.dispatch.send')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
