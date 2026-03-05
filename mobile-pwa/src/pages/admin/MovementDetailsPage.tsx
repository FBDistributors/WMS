import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { SendToPickingDialog } from '../../admin/components/orders/SendToPickingDialog'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../rbac/AuthProvider'
import type { MovementItem } from '../../services/ordersApi'

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
  const state = location.state as MovementState | null
  const movement = state?.movement
  const listPath = state?.listPath ?? '/admin/orders-diller'
  const listQuery = state?.listQuery ?? ''
  const backUrl = `${listPath}${listQuery ? `?${listQuery}` : ''}`
  const source = listPath.includes('orikzor') ? ('orikzor' as const) : ('diller' as const)
  const canSendToPicking = has('orders:send_to_picking')

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

  return (
    <AdminLayout title={t('orders:movement_details_title')}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => navigate(backUrl)}>
            <ArrowLeft size={16} />
            {t('common:buttons.back')}
          </Button>
          {canSendToPicking && items.length > 0 && movement.movement_id != null && (
            <Button onClick={() => setPickerDialogOpen(true)}>
              {t('orders:send_to_picking.button')}
            </Button>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs text-slate-500">{t('orders:columns_diller.order_number')}</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {mid}
            </div>
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
            <div className="text-sm text-slate-700 dark:text-slate-200">{items.length}</div>
          </div>
        </div>

        <TableScrollArea>
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="px-4 py-3 text-left">{t('orders:lines.sku')}</th>
                <th className="px-4 py-3 text-left">{t('orders:lines.qty')}</th>
                <th className="px-4 py-3 text-left">{t('orders:lines.price')}</th>
                <th className="px-4 py-3 text-left">{t('orders:lines.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((line, idx) => (
                <tr key={idx} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3">{String(line.product_code ?? '—')}</td>
                  <td className="px-4 py-3">{line.quantity != null ? String(line.quantity) : '—'}</td>
                  <td className="px-4 py-3">
                    {line.price != null ? Number(line.price).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {line.amount != null ? Number(line.amount).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>

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
    </AdminLayout>
  )
}
