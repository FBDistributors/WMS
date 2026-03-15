import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, RefreshCw, Search, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { TableSkeleton } from '../../components/ui/TableSkeleton'
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
    let list = roleFilter === 'all' ? items : items.filter((item) => item.role === roleFilter)
    // Kod bo'yicha sort: 001 birinchi, keyin 002, ..., kod bo'sh yoki raqam emaslar oxirida
    list = [...list].sort((a, b) => {
      const codeA = a.code ?? ''
      const codeB = b.code ?? ''
      const numA = /^\d+$/.test(codeA) ? parseInt(codeA, 10) : Infinity
      const numB = /^\d+$/.test(codeB) ? parseInt(codeB, 10) : Infinity
      if (numA !== numB) return numA - numB
      return (codeA || '').localeCompare(codeB || '')
    })
    return list
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
        <div className="flex flex-1 items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm dark:bg-slate-800">
          <Search size={18} className="text-slate-400" />
          <input
            className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
            placeholder={t('users:search_placeholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
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
        <Button variant="ghost" onClick={load} disabled={isLoading}>
          <RefreshCw size={16} className={isLoading ? 'animate-spin shrink-0' : 'shrink-0'} />
          {t('common:buttons.refresh')}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <PageSpinner label={t('common:messages.loading')} />
          <TableSkeleton rows={6} columns={4} rowHeight="h-14" />
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
        <TableScrollArea className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full min-w-[640px] table-auto border-collapse text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="px-4 py-3 text-left font-medium">
                  {t('users:columns.code')}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t('users:columns.login')}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t('users:columns.full_name')}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t('users:columns.role')}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t('users:columns.status')}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t('users:columns.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50"
                >
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                    {user.code ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                    {user.username}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                    {user.full_name || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                    {t(`users:roles.${user.role}`)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={user.is_active ? 'success' : 'neutral'}>
                      {user.is_active ? t('common:status.active') : t('common:status.inactive')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      className="p-2"
                      onClick={() => navigate(`/admin/users/${user.id}`)}
                      aria-label={t('users:actions.edit')}
                    >
                      <Pencil size={16} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
      )}
    </AdminLayout>
  )
}
