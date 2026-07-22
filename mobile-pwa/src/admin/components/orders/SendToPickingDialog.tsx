import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import { useAppToast } from '../../../feedback/useAppToast'
import {
  getPickerUsers,
  reassignOrderPicker,
  sendOrderToPicking,
  sendMovementToPicking,
  validateOrdersSendToPicking,
  type PickerUser,
  type MovementItem,
  type SendToPickingValidationFailureOut,
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

function parseInsufficientStockFailure(err: unknown): SendToPickingValidationFailureOut | null {
  if (!err || typeof err !== 'object' || !('details' in err)) return null
  const details = (err as ApiError).details
  if (!details || typeof details !== 'object') return null
  const detail = (details as { detail?: unknown }).detail
  if (!detail || typeof detail !== 'object') return null
  const o = detail as Record<string, unknown>
  if (o.code !== 'INSUFFICIENT_STOCK') return null
  const shortagesRaw = Array.isArray(o.shortages) ? o.shortages : []
  const shortages = shortagesRaw.map((row) => {
    const r = row as Record<string, unknown>
    return {
      line_id: String(r.line_id ?? ''),
      product_name: r.product_name != null ? String(r.product_name) : null,
      sku: r.sku != null ? String(r.sku) : null,
      barcode: r.barcode != null ? String(r.barcode) : null,
      required_qty:
        typeof r.required_qty === 'number' ? r.required_qty : Number(r.required_qty) || 0,
      allocated_qty:
        typeof r.allocated_qty === 'number' ? r.allocated_qty : Number(r.allocated_qty) || 0,
    }
  })
  return {
    order_id: String(o.order_id ?? ''),
    order_number: String(o.order_number ?? ''),
    code: 'insufficient_stock',
    message: null,
    shortages,
  }
}

function normalizeSendErrorMessage(msg: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const lower = msg.toLowerCase()
  if (lower.includes('insufficient stock')) return t('orders:send_to_picking.insufficient_stock')
  if (lower.includes('picking task already created')) return t('orders:send_to_picking.picking_task_exists')
  if (lower.includes('picking has started')) return t('orders:reassign_picker.error_picking_started')
  if (lower.includes('sent to controller')) return t('orders:reassign_picker.error_sent_to_controller')
  if (lower.includes('terminal state') || lower.includes('picked, completed')) {
    return t('orders:reassign_picker.error_terminal_doc')
  }
  return msg
}

export type MovementPayload = {
  source: 'diller' | 'orikzor'
  movement_id: string
  movement: MovementItem
}

type SendToPickingDialogProps = {
  open: boolean
  orderIds: string[]
  onOpenChange: (open: boolean) => void
  onSent: () => void
  /** `reassign`: faqat buyurtma IDlari; `send` bilan bir xil picker tanlash, lekin `reassignOrderPicker` chaqiriladi. */
  mode?: 'send' | 'reassign'
  /** Agar berilsa, orderIds o'rniga movement dan yuboriladi (sendMovementToPicking). */
  movementPayload?: MovementPayload | null
  /** Bir nechta movement ni yuborish (har biri uchun sendMovementToPicking). */
  movementPayloads?: MovementPayload[] | null
}

export function SendToPickingDialog({
  open,
  orderIds,
  onOpenChange,
  onSent,
  mode = 'send',
  movementPayload,
  movementPayloads,
}: SendToPickingDialogProps) {
  const { t } = useTranslation(['orders', 'common'])
  const { showError } = useAppToast()
  const [pickers, setPickers] = useState<PickerUser[]>([])
  const [selected, setSelected] = useState('')
  const [isLoadingPickers, setIsLoadingPickers] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [stockBlockFailures, setStockBlockFailures] = useState<SendToPickingValidationFailureOut[] | null>(null)

  useEffect(() => {
    if (!open) {
      setStockBlockFailures(null)
      return
    }
    setValidationError(null)
    setSelected('')
    setIsLoadingPickers(true)
    void (async () => {
      try {
        const data = await getPickerUsers()
        setPickers(data)
      } catch (err) {
        showError(formatApiError(err, t) || t('orders:send_to_picking.load_failed'))
      } finally {
        setIsLoadingPickers(false)
      }
    })()
  }, [open, showError, t])

  const isMovementMode = Boolean(movementPayload) || Boolean(movementPayloads?.length)
  const movementsCount = movementPayloads?.length ?? (movementPayload ? 1 : 0)
  if (!open) return null
  if (!isMovementMode && orderIds.length === 0) return null

  const handleSubmit = async () => {
    if (!selected) {
      setValidationError(t('orders:send_to_picking.picker_required'))
      return
    }
    const selectedStr = String(selected).trim()
    if (!isValidUuid(selectedStr)) {
      setValidationError(t('orders:send_to_picking.invalid_selection'))
      return
    }
    setIsSubmitting(true)
    setValidationError(null)
    try {
      let successCount = 0
      const failedMessages: string[] = []

      const movementInsufficient: SendToPickingValidationFailureOut[] = []

      if (movementPayloads?.length) {
        for (const payload of movementPayloads) {
          try {
            await sendMovementToPicking({
              source: payload.source,
              movement_id: payload.movement_id,
              movement: payload.movement,
              assigned_to_user_id: selectedStr,
            })
            successCount += 1
          } catch (err) {
            const ins = parseInsufficientStockFailure(err)
            if (ins) {
              movementInsufficient.push(ins)
              failedMessages.push(t('orders:send_to_picking.insufficient_stock'))
            } else {
              const msg = formatApiError(err, t) || t('orders:send_to_picking.failed')
              failedMessages.push(normalizeSendErrorMessage(msg, t))
            }
          }
        }
      } else if (isMovementMode && movementPayload) {
        try {
          await sendMovementToPicking({
            source: movementPayload.source,
            movement_id: movementPayload.movement_id,
            movement: movementPayload.movement,
            assigned_to_user_id: selectedStr,
          })
          successCount += 1
        } catch (err) {
          const ins = parseInsufficientStockFailure(err)
          if (ins) {
            movementInsufficient.push(ins)
            failedMessages.push(t('orders:send_to_picking.insufficient_stock'))
          } else {
            const msg = formatApiError(err, t) || t('orders:send_to_picking.failed')
            failedMessages.push(normalizeSendErrorMessage(msg, t))
          }
        }
      } else {
        const validIds = orderIds.filter((id) => isValidUuid(id))
        if (validIds.length === 0) {
          setValidationError(t('orders:send_to_picking.invalid_selection'))
          setIsSubmitting(false)
          return
        }
        if (mode === 'reassign' && validIds.length > 1) {
          setValidationError(t('orders:reassign_picker.one_order_only'))
          setIsSubmitting(false)
          return
        }
        if (mode === 'send') {
          try {
            const vr = await validateOrdersSendToPicking(validIds)
            if (!vr.ok) {
              setStockBlockFailures(vr.failures)
              return
            }
          } catch (err) {
            showError(formatApiError(err, t) || t('orders:send_to_picking.failed'))
            return
          }
        }
        for (const orderIdStr of validIds) {
          try {
            if (mode === 'reassign') {
              await reassignOrderPicker(orderIdStr, selectedStr)
            } else {
              await sendOrderToPicking(orderIdStr, selectedStr)
            }
            successCount += 1
          } catch (err) {
            const ins = parseInsufficientStockFailure(err)
            if (ins) {
              setStockBlockFailures([ins])
              return
            }
            const msg = formatApiError(err, t) || t('orders:send_to_picking.failed')
            failedMessages.push(normalizeSendErrorMessage(msg, t))
          }
        }
      }

      if (movementInsufficient.length > 0) {
        setStockBlockFailures(movementInsufficient)
        if (successCount > 0) {
          onSent()
        }
        return
      }
      if (successCount > 0) {
        onSent()
        onOpenChange(false)
        return
      }
      showError(
        failedMessages[0] ??
          (mode === 'reassign' ? t('orders:reassign_picker.failed') : t('orders:send_to_picking.failed'))
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      {stockBlockFailures && stockBlockFailures.length > 0 ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6">
          <button
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
            type="button"
            aria-label={t('common:buttons.close')}
            onClick={() => setStockBlockFailures(null)}
          />
          <div className="relative max-h-[85vh] w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
            <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {t('orders:send_to_picking.shortage_modal_title')}
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                {t('orders:send_to_picking.shortage_modal_intro')}
              </p>
            </div>
            <div className="max-h-[50vh] overflow-auto px-6 py-4">
              {stockBlockFailures.map((fail) => (
                <div key={fail.order_id} className="mb-6 last:mb-0">
                  <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                    {t('orders:send_to_picking.shortage_col_order')}: {fail.order_number || fail.order_id}
                  </div>
                  {fail.message && (!fail.shortages || fail.shortages.length === 0) ? (
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {fail.code === 'order_not_found'
                        ? t('orders:send_to_picking.fail_order_not_found')
                        : fail.message}
                    </p>
                  ) : (
                    <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          <th className="py-1 pr-2 font-medium">{t('orders:send_to_picking.shortage_col_product')}</th>
                          <th className="py-1 pr-2 font-medium">{t('orders:send_to_picking.shortage_col_sku')}</th>
                          <th className="py-1 pr-2 font-medium">{t('orders:send_to_picking.shortage_col_barcode')}</th>
                          <th className="py-1 pr-2 font-medium">{t('orders:send_to_picking.shortage_col_required')}</th>
                          <th className="py-1 font-medium">{t('orders:send_to_picking.shortage_col_allocated')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(fail.shortages ?? []).map((s) => (
                          <tr key={s.line_id} className="border-b border-slate-100 dark:border-slate-800">
                            <td className="py-1 pr-2 font-medium text-slate-900 dark:text-slate-100">
                              {s.product_name ?? '—'}
                            </td>
                            <td className="py-1 pr-2">{s.sku ?? '—'}</td>
                            <td className="py-1 pr-2">{s.barcode ?? '—'}</td>
                            <td className="py-1 pr-2">{s.required_qty}</td>
                            <td className="py-1">{s.allocated_qty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end border-t border-slate-200 px-6 py-4 dark:border-slate-800">
              <Button type="button" onClick={() => setStockBlockFailures(null)}>
                {t('orders:send_to_picking.shortage_modal_close')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <button
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-label={t('common:buttons.close')}
        type="button"
      />
      <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {!isMovementMode && mode === 'reassign'
              ? t('orders:reassign_picker.title')
              : movementsCount > 1
                ? t('orders:send_selected_to_picking', { count: movementsCount })
                : isMovementMode
                  ? t('orders:send_to_picking.title')
                  : orderIds.length > 1
                    ? t('orders:send_selected_to_picking', { count: orderIds.length })
                    : t('orders:send_to_picking.title')}
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
            {!validationError && !isLoadingPickers && pickers.length === 0 ? (
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
              {isSubmitting
                ? mode === 'reassign'
                  ? t('orders:reassign_picker.submitting')
                  : t('orders:send_to_picking.sending')
                : mode === 'reassign'
                  ? t('orders:reassign_picker.submit')
                  : t('orders:send_to_picking.send')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
