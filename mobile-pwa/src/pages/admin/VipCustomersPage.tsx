import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import {
  createVipCustomer,
  deleteVipCustomer,
  getVipCustomers,
  putVipCustomerBrandLimits,
  updateVipCustomer,
  type VipCustomer,
} from '../../services/vipCustomersApi'
import { getBrands, type Brand } from '../../services/brandsApi'
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
      return (
        <div className="relative flex-1 min-h-[200px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
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
            {items.map((vip) => {
              const overrides = vip.brand_limits?.length ?? 0
              return (
                <tr key={vip.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-900 dark:text-slate-100 sm:px-4">
                    {vip.customer_id}
                  </td>
                  <td className="min-w-[80px] px-3 py-3 text-slate-700 dark:text-slate-200 sm:px-4">
                    {vip.customer_name ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-slate-600 dark:text-slate-300 sm:px-4">
                    <div className="whitespace-nowrap">
                      {vip.min_expiry_months} {t('vipCustomers:months')}
                    </div>
                    {overrides > 0 ? (
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {t('vipCustomers:brand_overrides_count', { count: overrides })}
                      </div>
                    ) : null}
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
              )
            })}
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
        <div className="flex flex-nowrap items-end gap-3">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('vipCustomers:search')}
            <input
              className="mt-1 w-full min-w-[180px] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <Button variant="secondary" onClick={load} className="shrink-0">
            {t('common:buttons.refresh')}
          </Button>
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
        message={t('vipCustomers:confirm_delete', { name: (confirmDelete?.customer_name || confirmDelete?.customer_id) ?? '' })}
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
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandMonths, setBrandMonths] = useState<Record<string, number>>({})
  const [brandsLoading, setBrandsLoading] = useState(false)
  const [brandsError, setBrandsError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setCustomerId(target?.customer_id ?? '')
    setCustomerName(target?.customer_name ?? '')
    setMinExpiryMonths(target?.min_expiry_months ?? 6)
    setError(null)
    setBrandsError(null)
  }, [mode, target?.id, target?.customer_id, target?.customer_name, target?.min_expiry_months])

  useEffect(() => {
    if (mode !== 'edit' || !target) {
      setBrands([])
      setBrandMonths({})
      setBrandsLoading(false)
      return
    }
    let cancelled = false
    setBrandsLoading(true)
    setBrandsError(null)
    void getBrands(undefined, false)
      .then((list) => {
        if (cancelled) return
        const active = list.filter((b) => b.is_active)
        setBrands(active)
        const lim = new Map((target.brand_limits ?? []).map((x) => [x.brand_id, x.min_expiry_months]))
        const init: Record<string, number> = {}
        const def = target.min_expiry_months
        for (const b of active) {
          init[b.id] = lim.get(b.id) ?? def
        }
        setBrandMonths(init)
      })
      .catch(() => {
        if (!cancelled) setBrandsError(t('vipCustomers:brands_load_failed'))
      })
      .finally(() => {
        if (!cancelled) setBrandsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode, target, t])

  const validateMonths = (n: number) => n >= 1 && n <= 60

  const handleSubmit = async () => {
    if (!customerId.trim()) {
      setError(t('vipCustomers:validation.customer_id_required'))
      return
    }
    const defaultMonths = Number(minExpiryMonths)
    if (!validateMonths(defaultMonths)) {
      setError(t('vipCustomers:validation.months_range'))
      return
    }
    if (mode === 'edit' && target) {
      for (const b of brands) {
        const v = brandMonths[b.id]
        if (v === undefined || !validateMonths(Number(v))) {
          setError(t('vipCustomers:validation.months_range'))
          return
        }
      }
    }
    setIsSubmitting(true)
    setError(null)
    try {
      if (mode === 'create') {
        await createVipCustomer({
          customer_id: customerId.trim(),
          customer_name: customerName.trim() || null,
          min_expiry_months: defaultMonths,
        })
      } else if (target) {
        await updateVipCustomer(target.id, {
          customer_name: customerName.trim() || null,
          min_expiry_months: defaultMonths,
        })
        const limitsPayload = brands.map((b) => ({
          brand_id: b.id,
          min_expiry_months: Math.min(60, Math.max(1, Math.round(Number(brandMonths[b.id] ?? defaultMonths)))),
        }))
        await putVipCustomerBrandLimits(target.id, limitsPayload)
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('vipCustomers:save_failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const modalMax = mode === 'edit' ? 'max-w-2xl' : 'max-w-lg'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label={t('common:buttons.close')}
        type="button"
      />
      <div
        className={`relative w-full ${modalMax} max-h-[min(90vh,720px)] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950 flex flex-col`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {mode === 'create' ? t('vipCustomers:add') : t('vipCustomers:edit')}
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
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
            {mode === 'create' ? t('vipCustomers:fields.min_expiry_months_create') : t('vipCustomers:fields.min_expiry_months')}
            <input
              type="number"
              min={1}
              max={60}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={minExpiryMonths}
              onChange={(e) => setMinExpiryMonths(parseInt(e.target.value, 10) || 6)}
            />
          </label>

          {mode === 'edit' ? (
            <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
              <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {t('vipCustomers:brand_limits_heading')}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('vipCustomers:brand_limits_hint')}</p>
              {brandsLoading ? (
                <div className="flex min-h-[100px] items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                  {t('common:messages.loading')}
                </div>
              ) : brandsError ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  {brandsError}
                </div>
              ) : brands.length === 0 ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">{t('vipCustomers:no_active_brands')}</div>
              ) : (
                <div className="max-h-[min(40vh,320px)] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
                      <tr className="border-b border-slate-200 dark:border-slate-800">
                        <th className="px-3 py-2 text-left">{t('vipCustomers:brand_column')}</th>
                        <th className="w-28 px-3 py-2 text-right">{t('vipCustomers:months')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {brands.map((b) => (
                        <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 text-slate-800 dark:text-slate-200">
                            {b.display_name?.trim() || b.name}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={1}
                              max={60}
                              className="w-full rounded-xl border border-slate-200 bg-white px-2 py-1 text-right tabular-nums text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              value={brandMonths[b.id] ?? minExpiryMonths}
                              onChange={(e) => {
                                const n = parseInt(e.target.value, 10)
                                setBrandMonths((prev) => ({ ...prev, [b.id]: Number.isFinite(n) ? n : minExpiryMonths }))
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <Button variant="ghost" onClick={onClose}>
            {t('common:buttons.cancel')}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || (mode === 'edit' && (brandsLoading || !!brandsError))}
          >
            {isSubmitting ? t('vipCustomers:saving') : t('vipCustomers:save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
