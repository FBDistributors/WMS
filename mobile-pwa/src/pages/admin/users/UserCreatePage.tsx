import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../../admin/components/AdminLayout'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { createUser } from '../../../services/usersApi'
import type { UserRole } from '../../../types/users'

export function UserCreatePage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['users', 'common'])
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('picker')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password !== confirmPassword) {
      setError(t('users:messages.password_mismatch'))
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const created = await createUser({
        username: username.trim(),
        full_name: fullName.trim() || null,
        password,
        role,
        is_active: isActive,
      })
      navigate(`/admin/users/${created.id}`, { replace: true })
    } catch (err) {
      setError(t('users:messages.create_failed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AdminLayout title={t('users:form.create_title')}>
      <Card className="max-w-xl p-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="text-sm font-semibold text-slate-700">
              {t('users:form.username')}
            </label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-700">
              {t('users:form.full_name')}
            </label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-700">
              {t('users:form.role')}
            </label>
            <select
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
            >
              {(
                [
                  'warehouse_admin',
                  'supervisor',
                  'picker',
                  'receiver',
                  'inventory_controller',
                ] as UserRole[]
              ).map((item) => (
                <option key={item} value={item}>
                  {t(`users:roles.${item}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-700">
              {t('users:form.password')}
            </label>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-700">
              {t('users:form.confirm_password')}
            </label>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            {t('users:form.active')}
          </label>
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? t('common:messages.loading') : t('users:form.create')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/admin/users')}>
              {t('users:form.cancel')}
            </Button>
          </div>
        </form>
      </Card>
    </AdminLayout>
  )
}
