import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  createVipCustomer,
  deleteVipCustomer,
  getVipCustomers,
  updateVipCustomer,
  type VipCustomer,
} from '../../services/vipCustomersApi'
import { useAuth } from '../../rbac/AuthProvider'

type DialogState = {
  open: boolean
  mode: 'create' | 'edit'
  target?: VipCustomer
}

export function VipCustomersPage() {
  const { t } = useTranslation(['vipCustomers', 'admin', 'common'])
  const { has } = useAuth()
  const canManage = has('orders:read')
  const [items, setItems] = useState<VipCustomer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<DialogState>({ open: false, mode: 'create' })
  const [confirmDelete, setConfirmDelete] = useState<VipCustomer | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const list = await getVipCustomers(search.trim() || undefined)
      setItems(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('vipCustomers:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [search, t])

  useEffect(() => {
    void load()
  }, [load])

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('vipCustomers:empty')}
          description={t('vipCustomers:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    return (
      <TableScrollArea>
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('vipCustomers:columns.customer_id')}</th>
              <th className="px-3 py-3 text-left sm:px-4">{t('vipCustomers:columns.customer_name')}</th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('vipCustomers:columns.min_expiry_months')}</th>
              {canManage ? <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('vipCustomers:columns.actions')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((vip) => (
              <tr key={vip.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-900 dark:text-slate-100 sm:px-4">
                  {vip.customer_id}
                </td>
                <td className="min-w-[80px] px-3 py-3 text-slate-700 dark:text-slate-200 sm:px-4">
                  {vip.customer_name ?? '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300 sm:px-4">
                  {vip.min_expiry_months} {t('vipCustomers:months')}
                </td>
                {canManage ? (
                  <td className="whitespace-nowrap px-3 py-3 sm:px-4">
                    <div className="flex flex-nowrap items-center gap-1 sm:gap-2">
                      <Button
                        variant="ghost"
                        className="p-2"
                        onClick={() => setDialog({ open: true, mode: 'edit', target: vip })}
                        aria-label={t('vipCustomers:edit')}
                      >
                        <Pencil size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                        onClick={() => setConfirmDelete(vip)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [canManage, error, isLoading, items, load, t])

  return (
    <AdminLayout
      title={t('vipCustomers:title')}
      actionSlot={
        canManage ? (
          <Button onClick={() => setDialog({ open: true, mode: 'create' })} className="shrink-0">
            <Plus size={16} />
            <span className="hidden sm:inline">{t('vipCustomers:add')}</span>
          </Button>
        ) : null
      }
    >
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('vipCustomers:title')}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t('vipCustomers:subtitle')}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('vipCustomers:search')}
              <input
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <Button variant="secondary" onClick={load}>
              {t('common:buttons.refresh')}
            </Button>
          </div>
        </div>
        {content}
      </Card>

      {dialog.open ? (
        <VipCustomerDialog
          mode={dialog.mode}
          target={dialog.target}
          onClose={() => setDialog({ open: false, mode: 'create' })}
          onSaved={load}
        />
      ) : null}
      <ConfirmDialog
        open={!!confirmDelete}
        title={t('vipCustomers:confirm_delete_title')}
        message={t('vipCustomers:confirm_delete', { name: confirmDelete?.customer_name || confirmDelete?.customer_id ?? '' })}
        confirmLabel={t('vipCustomers:confirm_yes')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        loading={isDeleting}
        onConfirm={async () => {
          if (!confirmDelete) return
          setIsDeleting(true)
          try {
            await deleteVipCustomer(confirmDelete.id)
            setConfirmDelete(null)
            await load()
          } finally {
            setIsDeleting(false)
          }
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </AdminLayout>
  )
}

type DialogProps = {
  mode: 'create' | 'edit'
  target?: VipCustomer
  onClose: () => void
  onSaved: () => void
}

function VipCustomerDialog({ mode, target, onClose, onSaved }: DialogProps) {
  const { t } = useTranslation(['vipCustomers', 'common'])
  const [customerId, setCustomerId] = useState(target?.customer_id ?? '')
  const [customerName, setCustomerName] = useState(target?.customer_name ?? '')
  const [minExpiryMonths, setMinExpiryMonths] = useState(target?.min_expiry_months ?? 6)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!customerId.trim()) {
      setError(t('vipCustomers:validation.customer_id_required'))
      return
    }
    const months = Number(minExpiryMonths)
    if (months < 1 || months > 60) {
      setError(t('vipCustomers:validation.months_range'))
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      if (mode === 'create') {
        await createVipCustomer({
          customer_id: customerId.trim(),
          customer_name: customerName.trim() || null,
          min_expiry_months: months,
        })
      } else if (target) {
        await updateVipCustomer(target.id, {
          customer_name: customerName.trim() || null,
          min_expiry_months: months,
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('vipCustomers:save_failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label={t('common:buttons.close')}
        type="button"
      />
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {mode === 'create' ? t('vipCustomers:add') : t('vipCustomers:edit')}
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <div className="space-y-3 px-6 py-5">
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
              {error}
            </div>
          ) : null}
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('vipCustomers:fields.customer_id')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 disabled:opacity-60"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              disabled={mode === 'edit'}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('vipCustomers:fields.customer_name')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('vipCustomers:fields.min_expiry_months')}
            <input
              type="number"
              min={1}
              max={60}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={minExpiryMonths}
              onChange={(e) => setMinExpiryMonths(parseInt(e.target.value, 10) || 6)}
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common:buttons.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? t('vipCustomers:saving') : t('vipCustomers:save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
