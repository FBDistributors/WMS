import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  createBrand,
  deactivateBrand,
  getBrands,
  getUnknownBrandCodes,
  updateBrand,
  type Brand,
} from '../../services/brandsApi'
import { useAuth } from '../../rbac/AuthProvider'

type DialogState = {
  open: boolean
  mode: 'create' | 'edit'
  target?: Brand
}

export function BrandsPage() {
  const { t } = useTranslation(['brands', 'common'])
  const { has } = useAuth()
  const canManage = has('brands:manage')
  const [items, setItems] = useState<Brand[]>([])
  const [unknownCodes, setUnknownCodes] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [dialog, setDialog] = useState<DialogState>({ open: false, mode: 'create' })
  const [confirmDeactivate, setConfirmDeactivate] = useState<Brand | null>(null)
  const [isDeactivating, setIsDeactivating] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [brands, missing] = await Promise.all([
        getBrands(search.trim() || undefined, includeInactive),
        canManage ? getUnknownBrandCodes() : Promise.resolve([]),
      ])
      setItems(brands)
      setUnknownCodes(missing)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('brands:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [canManage, includeInactive, search, t])

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
          title={t('brands:empty')}
          description={t('brands:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    return (
      <TableScrollArea>
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-4 py-3 text-left">{t('brands:columns.code')}</th>
              <th className="px-4 py-3 text-left">{t('brands:columns.name')}</th>
              <th className="px-4 py-3 text-left">{t('brands:columns.display_name')}</th>
              <th className="px-4 py-3 text-left">{t('brands:columns.status')}</th>
              {canManage ? <th className="px-4 py-3 text-left">{t('brands:columns.actions')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((brand) => (
              <tr key={brand.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                  {brand.code}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{brand.name}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {brand.display_name ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {brand.is_active ? t('brands:status.active') : t('brands:status.inactive')}
                </td>
                {canManage ? (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        className="p-2"
                        onClick={() => setDialog({ open: true, mode: 'edit', target: brand })}
                        aria-label={t('brands:edit')}
                      >
                        <Pencil size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                        onClick={() => setConfirmDeactivate(brand)}
                      >
                        {t('brands:deactivate')}
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
      title={t('brands:title')}
      actionSlot={
        canManage ? (
          <Button onClick={() => setDialog({ open: true, mode: 'create' })}>
            <Plus size={16} />
            {t('brands:add')}
          </Button>
        ) : null
      }
    >
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('brands:title')}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t('brands:subtitle')}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('brands:search')}
              <input
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => setIncludeInactive(event.target.checked)}
              />
              {t('brands:show_inactive')}
            </label>
            <Button variant="secondary" onClick={load}>
              {t('common:buttons.refresh')}
            </Button>
          </div>
        </div>
        {unknownCodes.length > 0 && canManage ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10">
            {t('brands:unknown_codes')}: {unknownCodes.join(', ')}
          </div>
        ) : null}
        {content}
      </Card>

      {dialog.open ? (
        <BrandDialog
          mode={dialog.mode}
          target={dialog.target}
          onClose={() => setDialog({ open: false, mode: 'create' })}
          onSaved={load}
        />
      ) : null}
      <ConfirmDialog
        open={!!confirmDeactivate}
        title={t('brands:confirm_deactivate_title')}
        message={t('brands:confirm_deactivate', { name: confirmDeactivate?.name ?? '' })}
        confirmLabel={t('brands:confirm_yes')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        loading={isDeactivating}
        onConfirm={async () => {
          if (!confirmDeactivate) return
          setIsDeactivating(true)
          try {
            await deactivateBrand(confirmDeactivate.id)
            setConfirmDeactivate(null)
            await load()
          } finally {
            setIsDeactivating(false)
          }
        }}
        onCancel={() => setConfirmDeactivate(null)}
      />
    </AdminLayout>
  )
}

type DialogProps = {
  mode: 'create' | 'edit'
  target?: Brand
  onClose: () => void
  onSaved: () => void
}

function BrandDialog({ mode, target, onClose, onSaved }: DialogProps) {
  const { t } = useTranslation(['brands', 'common'])
  const [code, setCode] = useState(target?.code ?? '')
  const [name, setName] = useState(target?.name ?? '')
  const [displayName, setDisplayName] = useState(target?.display_name ?? '')
  const [isActive, setIsActive] = useState(target?.is_active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!code.trim() || !name.trim()) {
      setError(t('brands:validation.required'))
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      if (mode === 'create') {
        await createBrand({
          code: code.trim(),
          name: name.trim(),
          display_name: displayName.trim() || null,
          is_active: isActive,
        })
      } else if (target) {
        await updateBrand(target.id, {
          code: code.trim(),
          name: name.trim(),
          display_name: displayName.trim() || null,
          is_active: isActive,
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('brands:save_failed'))
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
            {mode === 'create' ? t('brands:add') : t('brands:edit')}
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
            {t('brands:fields.code')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('brands:fields.name')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('brands:fields.display_name')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            {t('brands:fields.active')}
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common:buttons.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? t('brands:saving') : t('brands:save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
