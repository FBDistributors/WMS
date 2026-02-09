import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  createLocation,
  deactivateLocation,
  getLocations,
  updateLocation,
  type Location,
} from '../../services/locationsApi'

type TreeNode = Location & { children: TreeNode[] }

const LOCATION_TYPES = ['zone', 'rack', 'shelf', 'bin'] as const
const PARENT_BY_TYPE: Record<(typeof LOCATION_TYPES)[number], string | null> = {
  zone: null,
  rack: 'zone',
  shelf: 'rack',
  bin: 'shelf',
}

type DialogState = {
  open: boolean
  mode: 'create' | 'edit'
  target?: Location
}

export function LocationsPage() {
  const { t } = useTranslation(['locations', 'common'])
  const [items, setItems] = useState<Location[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>({ open: false, mode: 'create' })
  const [includeInactive, setIncludeInactive] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getLocations(includeInactive)
      setItems(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('locations:load_failed')
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [includeInactive, t])

  useEffect(() => {
    void load()
  }, [load])

  const tree = useMemo(() => {
    const map = new Map<string, TreeNode>()
    const roots: TreeNode[] = []
    items.forEach((item) => {
      map.set(item.id, { ...item, children: [] })
    })
    map.forEach((node) => {
      if (node.parent_id && map.has(node.parent_id)) {
        map.get(node.parent_id)!.children.push(node)
      } else {
        roots.push(node)
      }
    })
    const sortTree = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => a.code.localeCompare(b.code))
      nodes.forEach((child) => sortTree(child.children))
    }
    sortTree(roots)
    return roots
  }, [items])

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return (
        <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
      )
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('locations:empty')}
          description={t('locations:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    const renderNode = (node: TreeNode, depth = 0) => (
      <div key={node.id}>
        <div className="flex items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-3">
            <div style={{ width: depth * 16 }} />
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {node.code}
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-300">{node.name}</div>
            <span className="rounded-xl bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              {t(`locations:types.${node.type}`)}
            </span>
            {!node.is_active ? (
              <span className="rounded-xl bg-red-50 px-2 py-0.5 text-xs text-red-500 dark:bg-red-500/10">
                {t('locations:inactive')}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setDialog({ open: true, mode: 'edit', target: node })}
            >
              {t('locations:edit')}
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await deactivateLocation(node.id)
                await load()
              }}
            >
              {t('locations:deactivate')}
            </Button>
          </div>
        </div>
        {node.children.length > 0 ? (
          <div className="space-y-1">{node.children.map((child) => renderNode(child, depth + 1))}</div>
        ) : null}
      </div>
    )
    return <div className="space-y-2">{tree.map((node) => renderNode(node))}</div>
  }, [error, isLoading, items.length, load, t, tree])

  return (
    <AdminLayout
      title={t('locations:title')}
      actionSlot={
        <Button onClick={() => setDialog({ open: true, mode: 'create' })}>
          <Plus size={16} />
          {t('locations:add')}
        </Button>
      }
    >
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('locations:title')}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t('locations:subtitle')}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
            {t('locations:show_inactive')}
          </label>
        </div>
        {content}
      </Card>

      {dialog.open ? (
        <LocationDialog
          mode={dialog.mode}
          target={dialog.target}
          locations={items}
          onClose={() => setDialog({ open: false, mode: 'create' })}
          onSaved={load}
        />
      ) : null}
    </AdminLayout>
  )
}

type DialogProps = {
  mode: 'create' | 'edit'
  target?: Location
  locations: Location[]
  onClose: () => void
  onSaved: () => void
}

function LocationDialog({ mode, target, locations, onClose, onSaved }: DialogProps) {
  const { t } = useTranslation(['locations', 'common'])
  const [code, setCode] = useState(target?.code ?? '')
  const [name, setName] = useState(target?.name ?? '')
  const [type, setType] = useState<(typeof LOCATION_TYPES)[number]>(target?.type ?? 'zone')
  const [parentId, setParentId] = useState<string>(target?.parent_id ?? '')
  const [isActive, setIsActive] = useState(target?.is_active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const parentOptions = useMemo(() => {
    const requiredParentType = PARENT_BY_TYPE[type]
    if (!requiredParentType) return []
    return locations.filter((loc) => loc.type === requiredParentType && loc.id !== target?.id)
  }, [locations, type, target?.id])

  const handleSubmit = async () => {
    if (!code.trim() || !name.trim()) {
      setError(t('locations:validation.required'))
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      if (mode === 'create') {
        await createLocation({
          code: code.trim(),
          name: name.trim(),
          type,
          parent_id: parentId || null,
          is_active: isActive,
        })
      } else if (target) {
        await updateLocation(target.id, {
          code: code.trim(),
          name: name.trim(),
          type,
          parent_id: parentId || null,
          is_active: isActive,
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('locations:save_failed')
      setError(message)
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
            {mode === 'create' ? t('locations:add') : t('locations:edit')}
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
            {t('locations:fields.code')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('locations:fields.name')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('locations:fields.type')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={type}
              onChange={(event) => {
                const nextType = event.target.value as (typeof LOCATION_TYPES)[number]
                setType(nextType)
                setParentId('')
              }}
            >
              {LOCATION_TYPES.map((item) => (
                <option key={item} value={item}>
                  {t(`locations:types.${item}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('locations:fields.parent')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">{t('locations:no_parent')}</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} · {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            {t('locations:fields.active')}
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common:buttons.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? t('locations:saving') : t('locations:save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
