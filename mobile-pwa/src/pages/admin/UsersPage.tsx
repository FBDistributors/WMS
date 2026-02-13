import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, Search, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { EmptyState } from '../../components/ui/EmptyState'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { listUsers } from '../../services/usersApi'
import type { UserRecord, UserRole } from '../../types/users'

export function UsersPage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['users', 'common'])
  const [items, setItems] = useState<UserRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await listUsers({ q: query || undefined, limit: 100, offset: 0 })
      setItems(data.items)
    } catch {
      setError(t('users:load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [query, t])

  useEffect(() => {
    const handle = setTimeout(() => {
      void load()
    }, 300)
    return () => clearTimeout(handle)
  }, [load])

  const filtered = useMemo(() => {
    if (roleFilter === 'all') return items
    return items.filter((item) => item.role === roleFilter)
  }, [items, roleFilter])

  return (
    <AdminLayout
      title={t('users:title')}
      actionSlot={
        <Button variant="secondary" onClick={() => navigate('/admin/users/new')}>
          + {t('users:new_user')}
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm">
          <Search size={18} className="text-slate-400" />
          <input
            className="w-full bg-transparent text-sm text-slate-900 outline-none"
            placeholder={t('users:search_placeholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value as UserRole | 'all')}
        >
          <option value="all">{t('users:roles.all')}</option>
          {(
            [
              'warehouse_admin',
              'supervisor',
              'picker',
              'receiver',
              'inventory_controller',
            ] as UserRole[]
          ).map((role) => (
            <option key={role} value={role}>
              {t(`users:roles.${role}`)}
            </option>
          ))}
        </select>
        <Button variant="ghost" onClick={load}>
          {t('common:buttons.refresh')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <div className="h-14 w-full animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-14 w-full animate-pulse rounded-2xl bg-slate-200" />
        </div>
      ) : error ? (
        <EmptyState
          icon={<Users size={32} />}
          title={error}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title={t('users:empty_title')}
          description={t('users:empty_desc')}
          actionLabel={t('common:buttons.create')}
          onAction={() => navigate('/admin/users/new')}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((user) => (
            <Card
              key={user.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">{user.username}</div>
                <div className="text-xs text-slate-500">
                  {user.full_name || '—'} · {t(`users:roles.${user.role}`)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={user.is_active ? 'success' : 'neutral'}>
                  {user.is_active ? t('common:status.active') : t('common:status.inactive')}
                </Badge>
                <Button
                  variant="ghost"
                  className="p-2"
                  onClick={() => navigate(`/admin/users/${user.id}`)}
                  aria-label={t('users:actions.edit')}
                >
                  <Pencil size={16} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AdminLayout>
  )
}
