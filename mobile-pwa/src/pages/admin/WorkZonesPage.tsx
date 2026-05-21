import { useCallback, useEffect, useMemo, useState } from 'react'
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
  createWorkZone,
  deleteWorkZone,
  getWorkZones,
  updateWorkZone,
  type WorkZone,
} from '../../services/workZonesApi'
import { useAuth } from '../../rbac/AuthProvider'

type DialogState = { open: boolean; mode: 'create' | 'edit'; target?: WorkZone }

export function WorkZonesPage() {
  const { t } = useTranslation(['workZones', 'common'])
  const { has } = useAuth()
  const canManage = has('orders:read')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<WorkZone[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>({ open: false, mode: 'create' })
  const [confirmDelete, setConfirmDelete] = useState<WorkZone | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const list = await getWorkZones(search.trim() || undefined)
      setItems(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workZones:load_failed'))
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
        room_id: x.room_id,
        name: x.name,
      })),
    [items],
  )

  const handleDelete = async () => {
    if (!confirmDelete) return
    setIsDeleting(true)
    try {
      await deleteWorkZone(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workZones:save_failed'))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AdminLayout
      title={t('workZones:title')}
      actionSlot={
        canManage ? (
          <Button onClick={() => setDialog({ open: true, mode: 'create' })} className="shrink-0">
            <Plus size={16} />
            <span className="hidden sm:inline">{t('workZones:add')}</span>
          </Button>
        ) : null
      }
    >
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">{t('workZones:subtitle')}</p>

      <Card className="relative space-y-4 p-4">
        {isLoading ? <LoadingOverlay /> : null}
        <label className="block text-sm text-slate-600 dark:text-slate-300">
          {t('workZones:search')}
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
          <EmptyState title={t('workZones:empty')} description={t('workZones:empty_desc')} />
        ) : (
          <TableScrollArea>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('workZones:columns.room_id')}</th>
                  <th className="px-3 py-3 text-left sm:px-4">{t('workZones:columns.name')}</th>
                  {canManage ? (
                    <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('workZones:columns.actions')}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-slate-900 dark:text-slate-100 sm:px-4">
                      {row.room_id}
                    </td>
                    <td className="px-3 py-3 text-slate-800 dark:text-slate-200 sm:px-4">{row.name ?? '—'}</td>
                    {canManage ? (
                      <td className="px-3 py-3 sm:px-4">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            className="p-2"
                            onClick={() => setDialog({ open: true, mode: 'edit', target: items.find((i) => i.id === row.id) })}
                            aria-label={t('workZones:edit')}
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
        <WorkZoneDialog
          mode={dialog.mode}
          target={dialog.target}
          onClose={() => setDialog({ open: false, mode: 'create' })}
          onSaved={() => void load()}
        />
      ) : null}

      <ConfirmDialog
        open={!!confirmDelete}
        title={t('workZones:confirm_delete_title')}
        message={t('workZones:confirm_delete', {
          name: confirmDelete?.name?.trim() || confirmDelete?.room_id || '—',
          roomId: confirmDelete?.room_id ?? '',
        })}
        confirmLabel={t('workZones:confirm_yes')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        loading={isDeleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
      />
    </AdminLayout>
  )
}

type DialogProps = {
  mode: 'create' | 'edit'
  target?: WorkZone
  onClose: () => void
  onSaved: () => void
}

function WorkZoneDialog({ mode, target, onClose, onSaved }: DialogProps) {
  const { t } = useTranslation(['workZones', 'common'])
  const [roomId, setRoomId] = useState(target?.room_id ?? '')
  const [name, setName] = useState(target?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setRoomId(target?.room_id ?? '')
    setName(target?.name ?? '')
    setError(null)
  }, [mode, target?.id, target?.room_id, target?.name])

  const handleSubmit = async () => {
    if (!roomId.trim()) {
      setError(t('workZones:validation.room_id_required'))
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      if (mode === 'create') {
        await createWorkZone({
          room_id: roomId.trim(),
          name: name.trim() || null,
        })
      } else if (target) {
        await updateWorkZone(target.id, {
          room_id: roomId.trim(),
          name: name.trim() || null,
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workZones:save_failed'))
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
            {mode === 'create' ? t('workZones:add') : t('workZones:edit')}
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
            {t('workZones:fields.room_id')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 disabled:opacity-60"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              disabled={mode === 'edit'}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('workZones:fields.name')}
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
            {isSubmitting ? t('workZones:saving') : t('workZones:save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
