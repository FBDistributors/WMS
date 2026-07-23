import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import { useAppToast } from '../../../feedback/useAppToast'
import {
  getControllerUsers,
  reassignOrderController,
  type ControllerUser,
} from '../../../services/ordersApi'
import type { ApiError } from '../../../services/apiClient'

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function isValidUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_REGEX.test(s)
}

function formatApiError(err: unknown, t: (key: string) => string): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const apiErr = err as ApiError
    if (apiErr.code === 'NETWORK') {
      if (apiErr.message === 'Request timeout') {
        return t('orders:send_to_picking.request_timeout')
      }
      return t('orders:send_to_picking.network_error')
    }
  }
  if (err && typeof err === 'object' && 'details' in err) {
    const apiErr = err as ApiError
    const d = apiErr.details
    if (d && typeof d === 'object' && 'detail' in d) {
      const detail = d.detail
      if (typeof detail === 'string') return detail
      if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg)
    }
    if (typeof apiErr.message === 'string') return apiErr.message
  }
  return err instanceof Error ? err.message : 'Error'
}

function normalizeReassignErrorMessage(
  msg: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const lower = msg.toLowerCase()
  if (lower.includes('verification already started')) {
    return t('orders:reassign_controller.error_verification_started')
  }
  if (lower.includes('completed') || lower.includes('verification')) {
    return t('orders:reassign_controller.error_terminal_doc')
  }
  if (lower.includes('not in the controller queue')) {
    return t('orders:reassign_controller.error_not_in_queue')
  }
  return msg
}

type ReassignControllerDialogProps = {
  open: boolean
  orderIds: string[]
  onOpenChange: (open: boolean) => void
  onReassigned: () => void
}

export function ReassignControllerDialog({
  open,
  orderIds,
  onOpenChange,
  onReassigned,
}: ReassignControllerDialogProps) {
  const { t } = useTranslation(['orders', 'common'])
  const { showError } = useAppToast()
  const [controllers, setControllers] = useState<ControllerUser[]>([])
  const [selected, setSelected] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setValidationError(null)
    setSelected('')
    setIsLoading(true)
    void (async () => {
      try {
        const data = await getControllerUsers()
        setControllers(data)
      } catch (err) {
        showError(formatApiError(err, t) || t('orders:controller_modal.loading'))
      } finally {
        setIsLoading(false)
      }
    })()
  }, [open, showError, t])

  if (!open) return null
  if (orderIds.length === 0) return null

  const handleSubmit = async () => {
    if (!selected) {
      setValidationError(t('orders:controller_modal.controller_placeholder'))
      return
    }
    const selectedStr = String(selected).trim()
    if (!isValidUuid(selectedStr)) {
      setValidationError(t('orders:send_to_picking.invalid_selection'))
      return
    }
    const validIds = orderIds.filter((id) => isValidUuid(id))
    if (validIds.length === 0) {
      setValidationError(t('orders:send_to_picking.invalid_selection'))
      return
    }
    if (validIds.length > 1) {
      setValidationError(t('orders:reassign_controller.one_order_only'))
      return
    }

    setIsSubmitting(true)
    setValidationError(null)
    try {
      await reassignOrderController(validIds[0], selectedStr)
      onReassigned()
      onOpenChange(false)
    } catch (err) {
      const msg = formatApiError(err, t) || t('orders:reassign_controller.failed')
      showError(normalizeReassignErrorMessage(msg, t))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
        type="button"
        aria-label={t('common:buttons.close')}
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('orders:reassign_controller.title')}
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
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('orders:controller_modal.controller_label')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={isLoading}
            >
              <option value="">
                {isLoading ? t('common:loading') : t('orders:controller_modal.controller_placeholder')}
              </option>
              {controllers
                .filter((c) => isValidUuid(c.id))
                .map((controller) => (
                  <option key={String(controller.id)} value={String(controller.id)}>
                    {controller.name}
                  </option>
                ))}
            </select>
            {!validationError && !isLoading && controllers.length === 0 ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {t('orders:reassign_controller.no_controllers_hint')}
              </p>
            ) : null}
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common:buttons.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? t('orders:reassign_controller.submitting') : t('orders:reassign_controller.submit')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
