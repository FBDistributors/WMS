import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import { ChevronRight, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import {
  createGeneralCustomer,
  deleteGeneralCustomer,
  getGeneralCustomers,
  importGeneralCustomers,
  type GeneralCustomer,
  type GeneralCustomerImportResult,
  updateGeneralCustomer,
} from '../../services/generalCustomersApi'
import { ProductSearchCombobox } from '../../components/ProductSearchCombobox'
import {
  createVipCustomer,
  deleteVipCustomer,
  getVipCustomers,
  putVipCustomerBrandLimits,
  putVipCustomerProductLimits,
  updateVipCustomer,
  VIP_DEFAULT_BRAND_EXPIRY_MONTHS,
  type VipCustomer,
} from '../../services/vipCustomersApi'
import type { Product } from '../../services/productsApi'
import { getBrands, type Brand } from '../../services/brandsApi'
import { useAppToast } from '../../feedback/useAppToast'
import { useAuth } from '../../rbac/AuthProvider'

type TabKey = 'vip' | 'general'
type VipDialogState = { open: boolean; mode: 'create' | 'edit'; target?: VipCustomer }
type GeneralDialogState = { open: boolean; mode: 'create' | 'edit'; target?: GeneralCustomer }

type CustomerTableRow = {
  id: string
  customer_id: string
  customer_name: string | null
  extra?: string
}

function formatVipBrandExpirySummary(
  v: VipCustomer,
  monthsLabel: string,
  productCountLabel?: (count: number) => string
): string {
  const lims = v.brand_limits ?? []
  if (lims.length === 0) return '—'
  const vals = lims.map((x) => x.min_expiry_months)
  const mn = Math.min(...vals)
  const mx = Math.max(...vals)
  const range = mn === mx ? `${mn} ${monthsLabel}` : `${mn}–${mx} ${monthsLabel}`
  const productCount = (v.product_limits ?? []).length
  if (productCount > 0 && productCountLabel) {
    return `${range} · ${productCountLabel(productCount)}`
  }
  return range
}

type VipProductLimitRow = {
  product_id: string
  brand_id: string
  sku: string
  name: string
  min_expiry_months: number
}

export type VipCustomersSectionProps = {
  embedded?: boolean
  setHeaderAction?: (node: ReactNode | null) => void
}

export function VipCustomersSection({ embedded = false, setHeaderAction }: VipCustomersSectionProps) {
  const { t } = useTranslation(['vipCustomers', 'admin', 'common'])
  const { has } = useAuth()
  const canManage = has('orders:read')
  const [tab, setTab] = useState<TabKey>('vip')
  const [search, setSearch] = useState('')
  const [vipItems, setVipItems] = useState<VipCustomer[]>([])
  const [generalItems, setGeneralItems] = useState<GeneralCustomer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { showError } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)
  const [vipDialog, setVipDialog] = useState<VipDialogState>({ open: false, mode: 'create' })
  const [generalDialog, setGeneralDialog] = useState<GeneralDialogState>({ open: false, mode: 'create' })
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setHasLoadError(false)
    try {
      if (tab === 'vip') {
        const list = await getVipCustomers(search.trim() || undefined)
        setVipItems(list)
      } else {
        const list = await getGeneralCustomers(search.trim() || undefined)
        setGeneralItems(list)
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : t('vipCustomers:load_failed'))
      setHasLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }, [search, showError, tab, t])

  useEffect(() => {
    void load()
  }, [load])

  const tableRows = useMemo<CustomerTableRow[]>(() => {
    if (tab === 'vip') {
      return vipItems.map((x) => ({
        id: x.id,
        customer_id: x.customer_id,
        customer_name: x.customer_name,
        extra: formatVipBrandExpirySummary(x, t('vipCustomers:months'), (count) =>
          t('vipCustomers:product_overrides_count', { count })
        ),
      }))
    }
    return generalItems.map((x) => ({
      id: x.id,
      customer_id: x.customer_id,
      customer_name: x.customer_name,
    }))
  }, [generalItems, tab, t, vipItems])

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="relative flex-1 min-h-[200px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
    }
    if (hasLoadError) {
      return (
        <EmptyState
          title={t('vipCustomers:load_failed')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      )
    }
    if (tableRows.length === 0) {
      return (
        <EmptyState
          title={tab === 'vip' ? t('vipCustomers:empty') : t('vipCustomers:general_empty')}
          description={tab === 'vip' ? t('vipCustomers:empty_desc') : t('vipCustomers:general_empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    return (
      <CustomerTable
        rows={tableRows}
        showExtra={tab === 'vip'}
        extraHeader={t('vipCustomers:columns.min_expiry_months')}
        canManage={canManage}
        onEdit={(id) => {
          if (tab === 'vip') {
            const target = vipItems.find((x) => x.id === id)
            if (target) setVipDialog({ open: true, mode: 'edit', target })
          } else {
            const target = generalItems.find((x) => x.id === id)
            if (target) setGeneralDialog({ open: true, mode: 'edit', target })
          }
        }}
        onDelete={(id) => setConfirmDeleteId(id)}
      />
    )
  }, [hasLoadError, isLoading, tableRows, tab, canManage, t, load, vipItems, generalItems])

  const actionLabel = tab === 'vip' ? t('vipCustomers:add') : t('vipCustomers:add_general')

  const addButton = useMemo(
    () =>
      canManage ? (
        <Button
          onClick={() =>
            tab === 'vip'
              ? setVipDialog({ open: true, mode: 'create' })
              : setGeneralDialog({ open: true, mode: 'create' })
          }
          className="shrink-0"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">{actionLabel}</span>
        </Button>
      ) : null,
    [actionLabel, canManage, tab],
  )

  useEffect(() => {
    if (!embedded || !setHeaderAction) return
    setHeaderAction(addButton)
    return () => setHeaderAction(null)
  }, [embedded, setHeaderAction, addButton])

  const body = (
    <>
      <Card className="space-y-4">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
          <Button type="button" variant={tab === 'vip' ? 'default' : 'secondary'} onClick={() => setTab('vip')}>
            {t('vipCustomers:tab_vip_customers')}
          </Button>
          <Button
            type="button"
            variant={tab === 'general' ? 'default' : 'secondary'}
            onClick={() => setTab('general')}
          >
            {t('vipCustomers:tab_general_customers')}
          </Button>
        </div>

        {tab === 'general' ? <GeneralImportPanel canManage={canManage} onImportDone={load} /> : null}

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

      {vipDialog.open ? (
        <VipCustomerDialog
          mode={vipDialog.mode}
          target={vipDialog.target}
          onClose={() => setVipDialog({ open: false, mode: 'create' })}
          onSaved={load}
        />
      ) : null}

      {generalDialog.open ? (
        <GeneralCustomerDialog
          mode={generalDialog.mode}
          target={generalDialog.target}
          onClose={() => setGeneralDialog({ open: false, mode: 'create' })}
          onSaved={load}
        />
      ) : null}

      <ConfirmDialog
        open={!!confirmDeleteId}
        title={t('vipCustomers:confirm_delete_title')}
        message={t('vipCustomers:confirm_delete', {
          name:
            (tab === 'vip'
              ? vipItems.find((x) => x.id === confirmDeleteId)?.customer_name ??
                vipItems.find((x) => x.id === confirmDeleteId)?.customer_id
              : generalItems.find((x) => x.id === confirmDeleteId)?.customer_name ??
                generalItems.find((x) => x.id === confirmDeleteId)?.customer_id) ?? '',
        })}
        confirmLabel={t('vipCustomers:confirm_yes')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        loading={isDeleting}
        onConfirm={async () => {
          if (!confirmDeleteId) return
          setIsDeleting(true)
          try {
            if (tab === 'vip') {
              await deleteVipCustomer(confirmDeleteId)
            } else {
              await deleteGeneralCustomer(confirmDeleteId)
            }
            setConfirmDeleteId(null)
            await load()
          } finally {
            setIsDeleting(false)
          }
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  )

  if (embedded) {
    return body
  }

  return (
    <AdminLayout title={t('vipCustomers:title')} actionSlot={addButton}>
      {body}
    </AdminLayout>
  )
}

function CustomerTable({
  rows,
  showExtra,
  extraHeader,
  canManage,
  onEdit,
  onDelete,
}: {
  rows: CustomerTableRow[]
  showExtra: boolean
  extraHeader: string
  canManage: boolean
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation(['vipCustomers'])

  return (
    <TableScrollArea>
      <table className="w-full min-w-[520px] text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr className="border-b border-slate-200 dark:border-slate-800">
            <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('vipCustomers:columns.customer_id')}</th>
            <th className="px-3 py-3 text-left sm:px-4">{t('vipCustomers:columns.customer_name')}</th>
            {showExtra ? <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{extraHeader}</th> : null}
            {canManage ? <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('vipCustomers:columns.actions')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-900 dark:text-slate-100 sm:px-4">
                {row.customer_id}
              </td>
              <td className="min-w-[80px] px-3 py-3 text-slate-700 dark:text-slate-200 sm:px-4">
                {row.customer_name ?? '—'}
              </td>
              {showExtra ? (
                <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300 sm:px-4">{row.extra ?? '—'}</td>
              ) : null}
              {canManage ? (
                <td className="whitespace-nowrap px-3 py-3 sm:px-4">
                  <div className="flex flex-nowrap items-center gap-1 sm:gap-2">
                    <Button variant="ghost" className="p-2" onClick={() => onEdit(row.id)} aria-label={t('vipCustomers:edit')}>
                      <Pencil size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                      onClick={() => onDelete(row.id)}
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
}

function GeneralImportPanel({ canManage, onImportDone }: { canManage: boolean; onImportDone: () => void }) {
  const { t } = useTranslation(['vipCustomers'])
  const { showError } = useAppToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [result, setResult] = useState<GeneralCustomerImportResult | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    setFile(f ?? null)
    setValidationError(null)
    setResult(null)
    setPreview('')
    if (!f) return
    if (f.name.toLowerCase().endsWith('.csv')) {
      const text = await f.slice(0, 12000).text()
      setPreview(text.split(/\r?\n/).slice(0, 18).join('\n'))
    } else {
      setPreview(`${f.name} (${Math.round(f.size / 1024)} KB)`)
    }
  }

  const submit = async () => {
    if (!canManage) return
    if (!file) {
      setValidationError(t('vipCustomers:general_import_no_file'))
      return
    }
    setBusy(true)
    setValidationError(null)
    setResult(null)
    try {
      const r = await importGeneralCustomers(file)
      setResult(r)
      await onImportDone()
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  if (!canManage) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">{t('vipCustomers:general_import_readonly')}</p>
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => void submit()} disabled={busy}>
          {busy ? t('vipCustomers:general_import_busy') : t('vipCustomers:general_import_button')}
        </Button>
        <input
          type="file"
          accept=".csv,.txt,.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="text-sm text-slate-700 dark:text-slate-200"
          onChange={onFile}
        />
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('vipCustomers:general_import_hint')}</p>
      {validationError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          {validationError}
        </div>
      ) : null}
      {preview ? (
        <pre className="max-h-48 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {preview}
        </pre>
      ) : null}
      {result ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-900/50">
          <div className="font-semibold text-slate-900 dark:text-slate-100">{t('vipCustomers:general_import_result')}</div>
          <ul className="mt-2 list-inside list-disc space-y-1 text-slate-700 dark:text-slate-300">
            <li>{t('vipCustomers:general_import_created', { n: result.created })}</li>
            <li>{t('vipCustomers:general_import_updated', { n: result.updated })}</li>
          </ul>
          {result.errors?.length ? (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-red-700 dark:text-red-300">
              {result.errors.map((e, i) => (
                <li key={`${e.row}-${i}`}>
                  {t('vipCustomers:general_import_row', { row: e.row })}: {e.detail}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
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
  const { showError, showWarning } = useAppToast()
  const [customerId, setCustomerId] = useState(target?.customer_id ?? '')
  const [customerName, setCustomerName] = useState(target?.customer_name ?? '')
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandMonths, setBrandMonths] = useState<Record<string, number>>({})
  const [productLimits, setProductLimits] = useState<VipProductLimitRow[]>([])
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set())
  const [brandsLoading, setBrandsLoading] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setCustomerId(target?.customer_id ?? '')
    setCustomerName(target?.customer_name ?? '')
    setValidationError(null)
    setExpandedBrands(new Set())
    if (mode === 'edit' && target) {
      setProductLimits(
        (target.product_limits ?? []).map((pl) => ({
          product_id: pl.product_id,
          brand_id: pl.brand_id,
          sku: pl.product_sku ?? '',
          name: pl.product_name ?? '',
          min_expiry_months: pl.min_expiry_months,
        }))
      )
    } else {
      setProductLimits([])
    }
  }, [mode, target?.id, target?.customer_id, target?.customer_name, target?.product_limits])

  useEffect(() => {
    let cancelled = false
    setBrandsLoading(true)
    void getBrands(undefined, false)
      .then((list) => {
        if (cancelled) return
        const active = list.filter((b) => b.is_active)
        setBrands(active)
        const init: Record<string, number> = {}
        if (mode === 'edit' && target) {
          const lim = new Map((target.brand_limits ?? []).map((x) => [x.brand_id, x.min_expiry_months]))
          for (const b of active) {
            init[b.id] = lim.get(b.id) ?? VIP_DEFAULT_BRAND_EXPIRY_MONTHS
          }
        } else {
          for (const b of active) {
            init[b.id] = VIP_DEFAULT_BRAND_EXPIRY_MONTHS
          }
        }
        setBrandMonths(init)
      })
      .catch(() => {
        if (!cancelled) showWarning(t('vipCustomers:brands_load_failed'))
      })
      .finally(() => {
        if (!cancelled) setBrandsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode, showWarning, target, t])

  const validateMonths = (n: number) => n >= 1 && n <= 60

  const toggleBrandExpanded = (brandId: string) => {
    setExpandedBrands((prev) => {
      const next = new Set(prev)
      if (next.has(brandId)) next.delete(brandId)
      else next.add(brandId)
      return next
    })
  }

  const addProductLimit = (brandId: string, product: Product) => {
    if (product.brand_id && product.brand_id !== brandId) {
      setValidationError(t('vipCustomers:product_wrong_brand'))
      return
    }
    if (productLimits.some((p) => p.product_id === product.id)) {
      setValidationError(t('vipCustomers:duplicate_product'))
      return
    }
    const defaultMonths = Math.min(
      60,
      Math.max(1, Math.round(Number(brandMonths[brandId] ?? VIP_DEFAULT_BRAND_EXPIRY_MONTHS)))
    )
    setProductLimits((prev) => [
      ...prev,
      {
        product_id: product.id,
        brand_id: brandId,
        sku: product.sku,
        name: product.name,
        min_expiry_months: defaultMonths,
      },
    ])
    setValidationError(null)
  }

  const removeProductLimit = (productId: string) => {
    setProductLimits((prev) => prev.filter((p) => p.product_id !== productId))
  }

  const updateProductLimitMonths = (productId: string, months: number) => {
    setProductLimits((prev) =>
      prev.map((p) => (p.product_id === productId ? { ...p, min_expiry_months: months } : p))
    )
  }

  const buildLimitsPayload = () =>
    brands.map((b) => ({
      brand_id: b.id,
      min_expiry_months: Math.min(
        60,
        Math.max(1, Math.round(Number(brandMonths[b.id] ?? VIP_DEFAULT_BRAND_EXPIRY_MONTHS)))
      ),
    }))

  const buildProductLimitsPayload = () =>
    productLimits.map((p) => ({
      product_id: p.product_id,
      min_expiry_months: Math.min(60, Math.max(1, Math.round(Number(p.min_expiry_months)))),
    }))

  const handleSubmit = async () => {
    if (!customerId.trim()) {
      setValidationError(t('vipCustomers:validation.customer_id_required'))
      return
    }
    for (const b of brands) {
      const v = brandMonths[b.id]
      if (v === undefined || !validateMonths(Number(v))) {
        setValidationError(t('vipCustomers:validation.months_range'))
        return
      }
    }
    for (const pl of productLimits) {
      if (!validateMonths(Number(pl.min_expiry_months))) {
        setValidationError(t('vipCustomers:validation.months_range'))
        return
      }
    }
    setIsSubmitting(true)
    setValidationError(null)
    try {
      const nameVal = customerName.trim() || null
      const productPayload = buildProductLimitsPayload()
      if (mode === 'create') {
        const limitsPayload = buildLimitsPayload()
        const created =
          brands.length > 0
            ? await createVipCustomer({
                customer_id: customerId.trim(),
                customer_name: nameVal,
                brand_limits: limitsPayload,
              })
            : await createVipCustomer({
                customer_id: customerId.trim(),
                customer_name: nameVal,
              })
        if (productPayload.length > 0) {
          await putVipCustomerProductLimits(created.id, productPayload)
        }
      } else if (target) {
        await updateVipCustomer(target.id, {
          customer_name: nameVal,
        })
        await putVipCustomerBrandLimits(target.id, buildLimitsPayload())
        await putVipCustomerProductLimits(target.id, productPayload)
      }
      onSaved()
      onClose()
    } catch (err) {
      showError(err instanceof Error ? err.message : t('vipCustomers:save_failed'))
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
      <div className="relative flex max-h-[min(90vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {mode === 'create' ? t('vipCustomers:add') : t('vipCustomers:edit')}
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {validationError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
              {validationError}
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

          <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {t('vipCustomers:brand_limits_heading')}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('vipCustomers:brand_limits_hint')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('vipCustomers:product_limits_hint')}</p>
            {brandsLoading ? (
              <div className="flex min-h-[100px] items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                {t('common:messages.loading')}
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
                    {brands.map((b) => {
                      const brandProducts = productLimits.filter((p) => p.brand_id === b.id)
                      const expanded = expandedBrands.has(b.id)
                      return (
                        <Fragment key={b.id}>
                          <tr className="border-b border-slate-100 dark:border-slate-800">
                            <td className="px-3 py-2 text-slate-800 dark:text-slate-200">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                                  onClick={() => toggleBrandExpanded(b.id)}
                                  aria-expanded={expanded}
                                  aria-label={t('vipCustomers:add_product_limit')}
                                >
                                  <ChevronRight
                                    size={16}
                                    className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
                                  />
                                </button>
                                <span>
                                  {b.display_name?.trim() || b.name}
                                  {brandProducts.length > 0 ? (
                                    <span className="ml-1 text-xs text-slate-500">
                                      ({brandProducts.length})
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min={1}
                                max={60}
                                className="w-full rounded-xl border border-slate-200 bg-white px-2 py-1 text-right tabular-nums text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                value={brandMonths[b.id] ?? VIP_DEFAULT_BRAND_EXPIRY_MONTHS}
                                onChange={(e) => {
                                  const n = parseInt(e.target.value, 10)
                                  setBrandMonths((prev) => ({
                                    ...prev,
                                    [b.id]: Number.isFinite(n) ? n : VIP_DEFAULT_BRAND_EXPIRY_MONTHS,
                                  }))
                                }}
                              />
                            </td>
                          </tr>
                          {expanded ? (
                            <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/40">
                              <td colSpan={2} className="px-3 py-3">
                                <div className="space-y-2 pl-6">
                                  <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                                    {t('vipCustomers:product_limits_heading')}
                                  </div>
                                  {brandProducts.map((pl) => (
                                    <div
                                      key={pl.product_id}
                                      className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-950"
                                    >
                                      <div className="min-w-0 flex-1 text-sm text-slate-800 dark:text-slate-200">
                                        <span className="font-medium">{pl.sku}</span>
                                        <span className="text-slate-500"> — {pl.name}</span>
                                      </div>
                                      <input
                                        type="number"
                                        min={1}
                                        max={60}
                                        className="w-20 rounded-xl border border-slate-200 bg-white px-2 py-1 text-right tabular-nums text-sm outline-none dark:border-slate-700 dark:bg-slate-900"
                                        value={pl.min_expiry_months}
                                        onChange={(e) => {
                                          const n = parseInt(e.target.value, 10)
                                          updateProductLimitMonths(
                                            pl.product_id,
                                            Number.isFinite(n) ? n : VIP_DEFAULT_BRAND_EXPIRY_MONTHS
                                          )
                                        }}
                                      />
                                      <span className="text-xs text-slate-500">{t('vipCustomers:months')}</span>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-8 w-8 shrink-0 rounded-full border border-red-200 px-0 text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
                                        onClick={() => removeProductLimit(pl.product_id)}
                                        aria-label={t('common:buttons.delete')}
                                      >
                                        <X size={16} strokeWidth={2.5} />
                                      </Button>
                                    </div>
                                  ))}
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <div className="min-w-0 flex-1">
                                      <ProductSearchCombobox
                                        value=""
                                        brandId={b.id}
                                        excludeProductIds={productLimits.map((p) => p.product_id)}
                                        placeholder={t('vipCustomers:add_product_limit')}
                                        onSelect={(product) => {
                                          if (product) addProductLimit(b.id, product)
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <Button variant="ghost" onClick={onClose}>
            {t('common:buttons.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={isSubmitting || brandsLoading}>
            {isSubmitting ? t('vipCustomers:saving') : t('vipCustomers:save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

type GeneralDialogProps = {
  mode: 'create' | 'edit'
  target?: GeneralCustomer
  onClose: () => void
  onSaved: () => void
}

function GeneralCustomerDialog({ mode, target, onClose, onSaved }: GeneralDialogProps) {
  const { t } = useTranslation(['vipCustomers', 'common'])
  const { showError } = useAppToast()
  const [customerId, setCustomerId] = useState(target?.customer_id ?? '')
  const [customerName, setCustomerName] = useState(target?.customer_name ?? '')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setCustomerId(target?.customer_id ?? '')
    setCustomerName(target?.customer_name ?? '')
    setValidationError(null)
  }, [mode, target?.id, target?.customer_id, target?.customer_name])

  const handleSubmit = async () => {
    if (!customerId.trim()) {
      setValidationError(t('vipCustomers:validation.customer_id_required'))
      return
    }
    setIsSubmitting(true)
    setValidationError(null)
    try {
      if (mode === 'create') {
        await createGeneralCustomer({
          customer_id: customerId.trim(),
          customer_name: customerName.trim() || null,
        })
      } else if (target) {
        await updateGeneralCustomer(target.id, {
          customer_name: customerName.trim() || null,
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      showError(err instanceof Error ? err.message : t('vipCustomers:save_failed'))
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
            {mode === 'create' ? t('vipCustomers:add_general') : t('vipCustomers:edit')}
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <div className="space-y-3 px-6 py-5">
          {validationError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
              {validationError}
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
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <Button variant="ghost" onClick={onClose}>
            {t('common:buttons.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting ? t('vipCustomers:saving') : t('vipCustomers:save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
