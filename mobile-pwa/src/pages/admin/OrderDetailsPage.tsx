import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAuth } from '../../rbac/AuthProvider'
import {
  addOrderLine,
  deleteOrderLine,
  formatSourceExternalIdDisplay,
  getOrder,
  type OrderDetails,
  type OrderLine,
} from '../../services/ordersApi'

export function OrderDetailsPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation(['orders', 'common'])
  const { has } = useAuth()
  const listPath = (location.state as { listPath?: string; listQuery?: string } | null)?.listPath
  const listQuery = (location.state as { listQuery?: string } | null)?.listQuery ?? ''
  const backUrl = listPath ? `${listPath}${listQuery ? `?${listQuery}` : ''}` : '/admin/orders'
  const [order, setOrder] = useState<OrderDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
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

  const orderStatusLabel = (status: string) =>
    t(`orders:status.${status}`, { defaultValue: status })

  const load = useCallback(async () => {
    if (!id) {
      setLoadError(t('orders:not_found'))
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setLoadError(null)
    try {
      const data = await getOrder(id)
      setOrder(data)
    } catch {
      setLoadError(t('orders:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    void load()
  }, [load])

  const canEditLines = Boolean(order?.lines_editable && has('orders:write'))

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
    if (!id || !order) return
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
      const next = await addOrderLine(id, {
        name,
        qty,
        sku: addSku.trim() || null,
        barcode: addBarcode.trim() || null,
        uom: addUom.trim() || null,
      })
      setOrder(next)
      setAddOpen(false)
    } catch (e) {
      setAddError(e instanceof Error ? e.message : t('orders:line_edit.failed'))
    } finally {
      setAddSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!id || !deleteTarget) return
    setDeleteSubmitting(true)
    try {
      const next = await deleteOrderLine(id, deleteTarget.id)
      setOrder(next)
      setDeleteTarget(null)
    } finally {
      setDeleteSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <AdminLayout title={t('orders:details_title')}>
        <div className="relative min-h-[200px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      </AdminLayout>
    )
  }

  if (!order || loadError) {
    return (
      <AdminLayout title={t('orders:details_title')}>
        <EmptyState
          title={loadError ?? t('orders:not_found')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={t('orders:details_title')}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => navigate(backUrl)}>
            <ArrowLeft size={16} />
            {t('common:buttons.back')}
          </Button>
          {canEditLines ? (
            <Button type="button" onClick={openAddDialog}>
              {t('orders:line_edit.add_line')}
            </Button>
          ) : null}
        </div>
        {order.lines_editable === false && has('orders:write') ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            {t('orders:line_edit.locked')}
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.order_number')}</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {order.order_number}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.external_id')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{formatSourceExternalIdDisplay(order.source_external_id) || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.status')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {orderStatusLabel(order.status)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.customer')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {order.customer_name ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.customer_id')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {order.customer_id ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.agent')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {order.agent_name ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.agent_id')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {order.agent_id ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.total_amount')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {order.total_amount == null ? '—' : Number(order.total_amount).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.delivery_date')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">
              {order.delivery_date
                ? new Date(order.delivery_date).toLocaleString(undefined, {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  })
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns.lines')}</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{order.lines.length}</div>
          </div>
        </div>

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
              {order.lines.map((line) => (
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
      </Card>

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {t('orders:line_edit.add_title')}
              </h2>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAddOpen(false)}
                aria-label={t('orders:line_edit.cancel')}
              >
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
