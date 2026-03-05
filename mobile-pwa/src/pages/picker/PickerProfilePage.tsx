import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, LogOut, Settings, Lock, AtSign } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useAuth } from '../../rbac/AuthProvider'
import { useTheme } from '../../theme/ThemeProvider'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { changePassword, updateMe } from '../../services/authApi'

export function PickerProfilePage() {
  const { t } = useTranslation(['picker', 'common', 'users'])
  const { user, logout, refreshUser } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [passwordLoading, setPasswordLoading] = useState(false)

  const [newUsername, setNewUsername] = useState(user?.username ?? '')
  const [usernameMessage, setUsernameMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [usernameLoading, setUsernameLoading] = useState(false)

  useEffect(() => {
    setNewUsername(user?.username ?? '')
  }, [user?.username])

  const handleLogout = async () => {
    setShowLogoutConfirm(false)
    await logout()
    navigate('/login')
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordMessage(null)
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: t('users:password_mismatch', 'Passwords do not match') })
      return
    }
    if (newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: t('common:profile_account.error_password_short') })
      return
    }
    if (!currentPassword) {
      setPasswordMessage({ type: 'error', text: t('common:profile_account.error_invalid_current') })
      return
    }
    setPasswordLoading(true)
    try {
      await changePassword(currentPassword, newPassword)
      setPasswordMessage({ type: 'success', text: t('common:profile_account.password_updated') })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: unknown) {
      const details = (err as { details?: { detail?: string } })?.details
      const detail = typeof details?.detail === 'string' ? details.detail : ''
      if (detail.toLowerCase().includes('invalid')) {
        setPasswordMessage({ type: 'error', text: t('common:profile_account.error_invalid_current') })
      } else {
        setPasswordMessage({ type: 'error', text: detail || t('common:errors.unknown') })
      }
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault()
    setUsernameMessage(null)
    const trimmed = newUsername.trim()
    if (trimmed.length < 3) {
      setUsernameMessage({ type: 'error', text: t('common:profile_account.error_username_taken') })
      return
    }
    if (trimmed === user?.username) return
    setUsernameLoading(true)
    try {
      await updateMe({ username: trimmed })
      await refreshUser()
      setUsernameMessage({ type: 'success', text: t('common:profile_account.username_updated') })
    } catch (err: unknown) {
      const details = (err as { details?: { detail?: string } })?.details
      const detail = typeof details?.detail === 'string' ? details.detail : ''
      if (detail.includes('exists') || detail.includes('taken') || detail.includes('already')) {
        setUsernameMessage({ type: 'error', text: t('common:profile_account.error_username_taken') })
      } else {
        setUsernameMessage({ type: 'error', text: detail || t('common:errors.unknown') })
      }
    } finally {
      setUsernameLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950">
      <AppHeader title={t('profile.title')} hideUserMenu />
      <div className="w-full max-w-xl mx-auto px-4 sm:px-6 pb-nav">
        {/* User info */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50">
              <User size={28} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {user?.name ?? '—'}
              </div>
              <div className="text-sm text-slate-500 dark:text-slate-400">
                {t(`common:roles.${user?.role}`)}
              </div>
            </div>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">{t('profile.username')}</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">
                {user?.username ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">{t('profile.phone')}</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">—</dd>
            </div>
          </dl>
        </div>

        {/* Change username */}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-600 dark:text-slate-400">
            <AtSign size={18} />
            {t('common:profile_account.change_username')}
          </div>
          <form onSubmit={handleChangeUsername} className="space-y-3">
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder={t('common:labels.username')}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              autoComplete="username"
              minLength={3}
            />
            {usernameMessage && (
              <p className={`text-sm ${usernameMessage.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {usernameMessage.text}
              </p>
            )}
            <button
              type="submit"
              disabled={usernameLoading || newUsername.trim() === user?.username}
              className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {usernameLoading ? t('common:messages.loading') : t('common:buttons.save')}
            </button>
          </form>
        </div>

        {/* Change password */}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-600 dark:text-slate-400">
            <Lock size={18} />
            {t('common:profile_account.change_password')}
          </div>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t('common:profile_account.current_password')}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              autoComplete="current-password"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('common:profile_account.new_password')}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              autoComplete="new-password"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('common:labels.confirm_password')}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              autoComplete="new-password"
            />
            {passwordMessage && (
              <p className={`text-sm ${passwordMessage.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {passwordMessage.text}
              </p>
            )}
            <button
              type="submit"
              disabled={passwordLoading}
              className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {passwordLoading ? t('common:messages.loading') : t('common:buttons.save')}
            </button>
          </form>
        </div>

        {/* Settings */}
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2 px-1 text-sm font-medium text-slate-600 dark:text-slate-400">
            <Settings size={18} />
            {t('profile.settings_section')}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
              {t('common:theme.label')}
            </div>
            <div className="flex gap-2">
              {(['light', 'dark'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTheme(m)}
                  className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${
                    theme === m
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {t(`common:theme.${m}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
              {t('common:labels.language')}
            </div>
            <LanguageSwitcher />
          </div>
        </div>

        {/* Logout */}
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/50"
          >
            <LogOut size={18} />
            {t('common:logout')}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={showLogoutConfirm}
        title={t('common:logout_confirm_title')}
        message={t('common:logout_confirm_message')}
        confirmLabel={t('common:logout')}
        cancelLabel={t('common:buttons.cancel')}
        onConfirm={handleLogout}
        onCancel={() => setShowLogoutConfirm(false)}
        variant="danger"
      />
    </div>
  )
}
