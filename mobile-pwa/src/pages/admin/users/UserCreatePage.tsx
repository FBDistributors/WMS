import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'

import { AdminLayout } from '../../../admin/components/AdminLayout'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import type { ApiError } from '../../../services/apiClient'
import { createUser } from '../../../services/usersApi'
import { useAppToast } from '../../../feedback/useAppToast'
import type { UserRole } from '../../../types/users'

function isFetchApiError(err: unknown): err is ApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    ((err as ApiError).code === 'HTTP' || (err as ApiError).code === 'NETWORK')
  )
}

function generateStrongPassword(): string {
  const length = 16
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  let password = ''
  
  // Ensure at least one of each required type
  password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]
  password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]
  password += '0123456789'[Math.floor(Math.random() * 10)]
  password += '!@#$%^&*'[Math.floor(Math.random() * 8)]
  
  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)]
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('')
}

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
  const { showError } = useAppToast()
  const [validationError, setValidationError] = useState<string | null>(null)
  const passwordMinLength = role === 'warehouse_admin' ? 10 : 6

  const handleGeneratePassword = () => {
    const newPassword = generateStrongPassword()
    setPassword(newPassword)
    setConfirmPassword(newPassword)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password !== confirmPassword) {
      setValidationError(t('users:messages.password_mismatch'))
      return
    }
    setIsSaving(true)
    setValidationError(null)
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
      if (!isFetchApiError(err)) {
        showError(t('users:messages.create_failed'))
      } else if (err.code === 'NETWORK') {
        showError(t('users:messages.network_error'))
      } else if (err.status === 409) {
        showError(t('users:messages.username_exists'))
      } else if (err.status === 403) {
        showError(t('users:messages.no_permission'))
      } else if (err.status === 400 && err.message) {
        showError(err.message)
      } else if (err.message) {
        showError(err.message)
      } else {
        showError(t('users:messages.create_failed'))
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AdminLayout title={t('users:form.create_title')}>
      <Card className="max-w-xl p-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {t('users:form.login')}
            </label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
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
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-700">
                {t('users:form.password')}
              </label>
              <button
                type="button"
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                onClick={handleGeneratePassword}
              >
                <RefreshCw size={14} />
                {t('users:form.generate_password')}
              </button>
            </div>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={passwordMinLength}
            />
            <p className="mt-1 text-xs text-slate-500">
              {role === 'warehouse_admin'
                ? t('users:form.password_hint_admin')
                : t('users:form.password_hint')}
            </p>
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
              minLength={passwordMinLength}
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
          {validationError ? <div className="text-sm text-red-600">{validationError}</div> : null}
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
