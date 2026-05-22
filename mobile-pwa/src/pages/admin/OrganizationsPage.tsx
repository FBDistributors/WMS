import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import {
  createSettingsOrganization,
  deleteSettingsOrganization,
  getSettingsOrganizations,
  updateSettingsOrganization,
  type SettingsOrganization,
} from '../../services/settingsOrganizationsApi'
import { useAuth } from '../../rbac/AuthProvider'

type DialogState = { open: boolean; mode: 'create' | 'edit'; target?: SettingsOrganization }

export type OrganizationsSectionProps = {
  embedded?: boolean
  setHeaderAction?: (node: ReactNode | null) => void
}

export function OrganizationsSection({
  embedded = false,
  setHeaderAction,
}: OrganizationsSectionProps) {
  const { t } = useTranslation(['organizations', 'common'])
  const { has } = useAuth()
  const canManage = has('orders:read')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<SettingsOrganization[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>({ open: false, mode: 'create' })
  const [confirmDelete, setConfirmDelete] = useState<SettingsOrganization | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const list = await getSettingsOrganizations(search.trim() || undefined)
      setItems(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizations:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [search, t])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(
    () =>
      items.map((x) => ({
        id: x.id,
        org_id: x.org_id,
        name: x.name,
      })),
    [items],
  )

  const handleDelete = async () => {
    if (!confirmDelete) return
    setIsDeleting(true)
    try {
      await deleteSettingsOrganization(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizations:save_failed'))
    } finally {
      setIsDeleting(false)
    }
  }

  const addButton = useMemo(
    () =>
      canManage ? (
        <Button onClick={() => setDialog({ open: true, mode: 'create' })} className="shrink-0">
          <Plus size={16} />
          <span className="hidden sm:inline">{t('organizations:add')}</span>
        </Button>
      ) : null,
    [canManage, t],
  )

  useEffect(() => {
    if (!embedded || !setHeaderAction) return
    setHeaderAction(addButton)
    return () => setHeaderAction(null)
  }, [embedded, setHeaderAction, addButton])

  const body = (
    <>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">{t('organizations:subtitle')}</p>

      <Card className="relative space-y-4 p-4">
        {isLoading ? <LoadingOverlay /> : null}
        <label className="block text-sm text-slate-600 dark:text-slate-300">
          {t('organizations:search')}
          <input
            className="mt-1 w-full max-w-md rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {!isLoading && rows.length === 0 ? (
          <EmptyState title={t('organizations:empty')} description={t('organizations:empty_desc')} />
        ) : (
          <TableScrollArea>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                    {t('organizations:columns.org_id')}
                  </th>
                  <th className="px-3 py-3 text-left sm:px-4">{t('organizations:columns.name')}</th>
                  {canManage ? (
                    <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                      {t('organizations:columns.actions')}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-slate-900 dark:text-slate-100 sm:px-4">
                      {row.org_id}
                    </td>
                    <td className="px-3 py-3 text-slate-800 dark:text-slate-200 sm:px-4">{row.name ?? '—'}</td>
                    {canManage ? (
                      <td className="px-3 py-3 sm:px-4">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            className="p-2"
                            onClick={() =>
                              setDialog({
                                open: true,
                                mode: 'edit',
                                target: items.find((i) => i.id === row.id),
                              })
                            }
                            aria-label={t('organizations:edit')}
                          >
                            <Pencil size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                            onClick={() => setConfirmDelete(items.find((i) => i.id === row.id) ?? null)}
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
        )}
      </Card>

      {dialog.open ? (
        <OrganizationDialog
          mode={dialog.mode}
          target={dialog.target}
          onClose={() => setDialog({ open: false, mode: 'create' })}
          onSaved={() => void load()}
        />
      ) : null}

      <ConfirmDialog
        open={!!confirmDelete}
        title={t('organizations:confirm_delete_title')}
        message={t('organizations:confirm_delete', {
          name: confirmDelete?.name?.trim() || confirmDelete?.org_id || '—',
          orgId: confirmDelete?.org_id ?? '',
        })}
        confirmLabel={t('organizations:confirm_yes')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        loading={isDeleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  )

  if (embedded) {
    return body
  }

  return (
    <AdminLayout title={t('organizations:title')} actionSlot={addButton}>
      {body}
    </AdminLayout>
  )
}

type DialogProps = {
  mode: 'create' | 'edit'
  target?: SettingsOrganization
  onClose: () => void
  onSaved: () => void
}

function OrganizationDialog({ mode, target, onClose, onSaved }: DialogProps) {
  const { t } = useTranslation(['organizations', 'common'])
  const [orgId, setOrgId] = useState(target?.org_id ?? '')
  const [name, setName] = useState(target?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setOrgId(target?.org_id ?? '')
    setName(target?.name ?? '')
    setError(null)
  }, [mode, target?.id, target?.org_id, target?.name])

  const handleSubmit = async () => {
    if (!orgId.trim()) {
      setError(t('organizations:validation.org_id_required'))
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      if (mode === 'create') {
        await createSettingsOrganization({
          org_id: orgId.trim(),
          name: name.trim() || null,
        })
      } else if (target) {
        await updateSettingsOrganization(target.id, {
          org_id: orgId.trim(),
          name: name.trim() || null,
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizations:save_failed'))
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
            {mode === 'create' ? t('organizations:add') : t('organizations:edit')}
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
            {t('organizations:fields.org_id')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 disabled:opacity-60"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              disabled={mode === 'edit'}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('organizations:fields.name')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <Button variant="ghost" onClick={onClose}>
            {t('common:buttons.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting ? t('organizations:saving') : t('organizations:save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
