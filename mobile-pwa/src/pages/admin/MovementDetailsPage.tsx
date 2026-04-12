import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { SendToPickingDialog } from '../../admin/components/orders/SendToPickingDialog'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAuth } from '../../rbac/AuthProvider'
import { getProducts } from '../../services/productsApi'
import {
  addOrderLine,
  deleteOrderLine,
  ensureMovementOrder,
  type MovementItem,
  type OrderDetails,
  type OrderLine,
} from '../../services/ordersApi'

type MovementState = {
  movement: MovementItem
  listPath?: string
  listQuery?: string
}

export function MovementDetailsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation(['orders', 'common'])
  const { has } = useAuth()
  const [pickerDialogOpen, setPickerDialogOpen] = useState(false)
  const [productBySku, setProductBySku] = useState<Map<string, { name: string; barcode: string | null }>>(new Map())
  const state = location.state as MovementState | null
  const movement = state?.movement

  const [linkedOrder, setLinkedOrder] = useState<OrderDetails | null>(null)
  const [ensureLoading, setEnsureLoading] = useState(false)
  const [ensureError, setEnsureError] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addSku, setAddSku] = useState('')
  const [addBarcode, setAddBarcode] = useState('')
  const [addQty, setAddQty] = useState('1')
  const [addUom, setAddUom] = useState('')
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OrderLine | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  const listPath = state?.listPath ?? '/admin/orders-diller'
  const listQuery = state?.listQuery ?? ''
  const backUrl = `${listPath}${listQuery ? `?${listQuery}` : ''}`
  const source = listPath.includes('orikzor') ? ('orikzor' as const) : ('diller' as const)
  const canSendToPicking = has('orders:send_to_picking')
  const movementId = useMemo(
    () => (movement?.movement_id != null ? String(movement.movement_id).trim() : ''),
    [movement],
  )

  useEffect(() => {
    const rawItems = movement?.movement_items
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      setProductBySku(new Map())
      return
    }
    const items = rawItems as Array<Record<string, unknown>>
    const skus = [
      ...new Set(items.map((line) => String(line.product_code ?? line.productCode ?? '').trim()).filter(Boolean)),
    ]
    if (skus.length === 0) {
      setProductBySku(new Map())
      return
    }
    getProducts({ skus, limit: 500 })
      .then((res) => {
        const map = new Map<string, { name: string; barcode: string | null }>()
        res.items.forEach((p) => {
          map.set(p.sku, { name: p.name, barcode: p.barcode ?? (p.barcodes?.[0] ?? null) ?? null })
        })
        setProductBySku(map)
      })
      .catch(() => setProductBySku(new Map()))
  }, [movement])

  useEffect(() => {
    if (!movement || !movementId || !has('orders:write')) {
      setLinkedOrder(null)
      setEnsureError(null)
      setEnsureLoading(false)
      return
    }
    let cancelled = false
    setEnsureLoading(true)
    setEnsureError(null)
    void ensureMovementOrder({ source, movement_id: movementId, movement })
      .then((o) => {
        if (!cancelled) setLinkedOrder(o)
      })
      .catch(() => {
        if (!cancelled) setEnsureError(t('orders:movement_ensure_failed'))
      })
      .finally(() => {
        if (!cancelled) setEnsureLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [movement, movementId, source, has, t])

  const canEditLines = Boolean(linkedOrder?.lines_editable && has('orders:write'))

  const openAddDialog = () => {
    setAddName('')
    setAddSku('')
    setAddBarcode('')
    setAddQty('1')
    setAddUom('')
    setAddError(null)
    setAddOpen(true)
  }

  const submitAddLine = async () => {
    if (!linkedOrder) return
    const name = addName.trim()
    const qty = Number.parseFloat(addQty.replace(',', '.'))
    if (!name) {
      setAddError(t('orders:line_edit.name_required'))
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setAddError(t('orders:line_edit.qty_invalid'))
      return
    }
    setAddSubmitting(true)
    setAddError(null)
    try {
      const next = await addOrderLine(linkedOrder.id, {
        name,
        qty,
        sku: addSku.trim() || null,
        barcode: addBarcode.trim() || null,
        uom: addUom.trim() || null,
      })
      setLinkedOrder(next)
      setAddOpen(false)
    } catch (e) {
      setAddError(e instanceof Error ? e.message : t('orders:line_edit.failed'))
    } finally {
      setAddSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!linkedOrder || !deleteTarget) return
    setDeleteSubmitting(true)
    try {
      const next = await deleteOrderLine(linkedOrder.id, deleteTarget.id)
      setLinkedOrder(next)
      setDeleteTarget(null)
    } finally {
      setDeleteSubmitting(false)
    }
  }

  if (!movement) {
    return (
      <AdminLayout title={t('orders:movement_details_title')}>
        <Card className="space-y-4">
          <Button variant="ghost" onClick={() => navigate(backUrl)}>
            <ArrowLeft size={16} />
            {t('common:buttons.back')}
          </Button>
          <EmptyState
            title={t('orders:movement_not_found')}
            actionLabel={t('common:buttons.back')}
            onAction={() => navigate(backUrl)}
          />
        </Card>
      </AdminLayout>
    )
  }

  const mid = (movement.movement_id as string) ?? '—'
  const deliveryNo = (movement.delivery_number as string) ?? '—'
  const barcode = (movement.barcode as string) ?? '—'
  const note = (movement.note as string) ?? '—'
  const amount = movement.amount != null ? Number(movement.amount).toLocaleString() : '—'
  const status = (movement.status as string) ?? '—'
  const fromWh = (movement.from_warehouse_code as string) ?? '—'
  const toWh = (movement.to_warehouse_code as string) ?? '—'
  const fromTime = (movement.from_time as string) ?? '—'
  const items = (movement.movement_items as Array<Record<string, unknown>>) ?? []

  const showEditableTable = linkedOrder && !ensureLoading
  const orderLines = linkedOrder?.lines ?? []

  return (
    <AdminLayout title={t('orders:movement_details_title')}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => navigate(backUrl)}>
            <ArrowLeft size={16} />
            {t('common:buttons.back')}
          </Button>
          <div className="flex flex-wrap gap-2">
            {canEditLines ? (
              <Button type="button" onClick={openAddDialog}>
                {t('orders:line_edit.add_line')}
              </Button>
            ) : null}
            {canSendToPicking && items.length > 0 && movement.movement_id != null && (
              <Button onClick={() => setPickerDialogOpen(true)}>{t('orders:send_to_picking.button')}</Button>
            )}
          </div>
        </div>

        {linkedOrder?.lines_editable === false && has('orders:write') ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            {t('orders:line_edit.locked')}
          </p>
        ) : null}
        {ensureError ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            <span>{ensureError}</span>
            <Button
              type="button"
              variant="ghost"
              className="shrink-0"
              onClick={() => {
                setEnsureError(null)
                void (async () => {
                  if (!movementId || !movement) return
                  setEnsureLoading(true)
                  try {
                    const o = await ensureMovementOrder({ source, movement_id: movementId, movement })
                    setLinkedOrder(o)
                  } catch {
                    setEnsureError(t('orders:movement_ensure_failed'))
                  } finally {
                    setEnsureLoading(false)
                  }
                })()
              }}
            >
              {t('common:buttons.retry')}
            </Button>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns_diller.order_number')}</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{mid}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns_diller.external_id')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{barcode}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns_diller.status')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{status}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:movement_delivery_number')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{deliveryNo}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns_diller.from_warehouse_code')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{fromWh}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns_diller.to_warehouse_code')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{toWh}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns_diller.movement_note')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200 max-w-md truncate" title={note}>
              {note}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns_diller.total_amount')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{amount}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns_diller.delivery_date')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{fromTime}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns_diller.lines')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {showEditableTable ? orderLines.length : items.length}
            </div>
          </div>
        </div>

        <div className="relative min-h-[120px]">
          {ensureLoading ? (
            <LoadingOverlay label={t('orders:movement_ensure_loading')} />
          ) : null}
          {!ensureLoading && showEditableTable ? (
            <>
              {canEditLines ? (
                <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{t('orders:line_edit.hint_catalog')}</p>
              ) : null}
              <TableScrollArea>
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr className="border-b border-slate-200 dark:border-slate-800">
                      <th className="px-4 py-3 text-left">{t('orders:lines.sku')}</th>
                      <th className="px-4 py-3 text-left">{t('orders:lines.barcode')}</th>
                      <th className="px-4 py-3 text-left">{t('orders:lines.name')}</th>
                      <th className="px-4 py-3 text-left">{t('orders:lines.qty')}</th>
                      <th className="px-4 py-3 text-left">{t('orders:lines.uom')}</th>
                      {canEditLines ? (
                        <th className="px-4 py-3 text-right">{t('orders:line_edit.actions')}</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {orderLines.map((line) => (
                      <tr key={line.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-4 py-3">{line.sku ?? '—'}</td>
                        <td className="px-4 py-3">{line.barcode ?? '—'}</td>
                        <td className="px-4 py-3">{line.name}</td>
                        <td className="px-4 py-3">{line.qty}</td>
                        <td className="px-4 py-3">{line.uom ?? '—'}</td>
                        {canEditLines ? (
                          <td className="px-4 py-3 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              className="text-red-600 hover:text-red-700"
                              aria-label={t('orders:line_edit.delete')}
                              onClick={() => setDeleteTarget(line)}
                            >
                              <Trash2 size={16} />
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScrollArea>
            </>
          ) : null}
          {!ensureLoading && !showEditableTable ? (
            <TableScrollArea>
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="px-4 py-3 text-left">{t('orders:lines.sku')}</th>
                    <th className="px-4 py-3 text-left">{t('orders:lines.name')}</th>
                    <th className="px-4 py-3 text-left">{t('orders:lines.barcode')}</th>
                    <th className="px-4 py-3 text-left">{t('orders:lines.qty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((line, idx) => {
                    const sku = String(line.product_code ?? line.productCode ?? '').trim()
                    const product = sku ? productBySku.get(sku) : undefined
                    const name =
                      (product?.name ?? line.name ?? line.product_name) != null &&
                      String(product?.name ?? line.name ?? line.product_name).trim() !== ''
                        ? String(product?.name ?? line.name ?? line.product_name)
                        : '—'
                    const rawBarcode = product?.barcode ?? line.barcode ?? line.product_barcode
                    const lineBarcode =
                      rawBarcode != null && String(rawBarcode).trim() !== '' ? String(rawBarcode) : '—'
                    return (
                      <tr key={idx} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-4 py-3">{sku || '—'}</td>
                        <td className="px-4 py-3">{name}</td>
                        <td className="px-4 py-3">{lineBarcode}</td>
                        <td className="px-4 py-3">{line.quantity != null ? String(line.quantity) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </TableScrollArea>
          ) : null}
        </div>

        <SendToPickingDialog
          open={pickerDialogOpen}
          orderIds={[]}
          onOpenChange={setPickerDialogOpen}
          onSent={() => {
            setPickerDialogOpen(false)
            navigate(backUrl)
          }}
          movementPayload={
            movement && movement.movement_id != null
              ? {
                  source,
                  movement_id: String(movement.movement_id),
                  movement,
                }
              : null
          }
        />
      </Card>

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {t('orders:line_edit.add_title')}
              </h2>
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)} aria-label={t('orders:line_edit.cancel')}>
                <X size={20} />
              </Button>
            </div>
            <div className="space-y-3 px-6 py-5">
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('orders:line_edit.hint_catalog')}</p>
              <label className="block text-sm text-slate-600 dark:text-slate-300">
                {t('orders:lines.name')}
                <input
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder={t('orders:line_edit.name_placeholder')}
                />
              </label>
              <label className="block text-sm text-slate-600 dark:text-slate-300">
                {t('orders:lines.qty')}
                <input
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={addQty}
                  onChange={(e) => setAddQty(e.target.value)}
                  inputMode="decimal"
                  placeholder={t('orders:line_edit.qty_placeholder')}
                />
              </label>
              <label className="block text-sm text-slate-600 dark:text-slate-300">
                {t('orders:lines.sku')}
                <input
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={addSku}
                  onChange={(e) => setAddSku(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-600 dark:text-slate-300">
                {t('orders:lines.barcode')}
                <input
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={addBarcode}
                  onChange={(e) => setAddBarcode(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-600 dark:text-slate-300">
                {t('orders:lines.uom')}
                <input
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={addUom}
                  onChange={(e) => setAddUom(e.target.value)}
                />
              </label>
              {addError ? (
                <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                  {addError}
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
                {t('orders:line_edit.cancel')}
              </Button>
              <Button type="button" onClick={() => void submitAddLine()} disabled={addSubmitting}>
                {addSubmitting ? t('common:messages.loading') : t('orders:line_edit.save')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('orders:line_edit.delete_title')}
        message={t('orders:line_edit.delete_message', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('orders:line_edit.delete')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        loading={deleteSubmitting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </AdminLayout>
  )
}
