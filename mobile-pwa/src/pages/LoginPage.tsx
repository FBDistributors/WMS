import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'

import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { useAuth } from '../rbac/AuthProvider'
import { BRAND } from '../config/branding'
import { getHomeRouteForRole } from '../rbac/routes'
import { buildApiUrl } from '../services/apiClient'

export function LoginPage() {
  const { signIn, user, isLoading: isAuthLoading } = useAuth()
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null)
  const isSubmittingRef = useRef(false)

  const from = (location.state as { from?: Location })?.from?.pathname

  // Check for session expired message
  useEffect(() => {
    const reason = sessionStorage.getItem('session_expired_reason')
    if (reason === 'another_device') {
      setSessionExpiredMessage(t('session_expired_another_device'))
      sessionStorage.removeItem('session_expired_reason')
    }
  }, [])

  useEffect(() => {
    if (isSubmittingRef.current) {
      return
    }
    if (!isAuthLoading && user) {
      navigate(getHomeRouteForRole(user.role), { replace: true })
    }
  }, [isAuthLoading, navigate, user])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsLoading(true)
    setError(null)
    setSessionExpiredMessage(null)
    isSubmittingRef.current = true
    try {
      const nextUser = await signIn(username, password)
      const home = getHomeRouteForRole(nextUser.role)
      const shouldUseFrom =
        from &&
        ((home === '/admin' && from.startsWith('/admin')) ||
          (home === '/picker' && (from.startsWith('/picker') || from.startsWith('/picking'))) ||
          (home === '/controller' &&
            (from.startsWith('/controller') || from.startsWith('/picking'))))
      navigate(shouldUseFrom ? from : home, { replace: true })
    } catch {
      setError(t('invalid_credentials'))
    } finally {
      setIsLoading(false)
      isSubmittingRef.current = false
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher compact />
      </div>
      <div className="mb-8 flex flex-col items-center gap-4">
        <img src={BRAND.logoIcon} alt="" className="h-20 w-auto object-contain sm:h-24" aria-hidden />
        <span className="text-center text-lg font-semibold tracking-tight text-slate-800 dark:text-slate-200 sm:text-xl">{BRAND.name}</span>
      </div>
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-4 text-center text-xl font-semibold text-slate-900 dark:text-slate-100">{t('title')}</h1>
        {sessionExpiredMessage ? (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            {sessionExpiredMessage}
          </div>
        ) : null}
        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder={t('username_placeholder')}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              className="w-full appearance-none rounded-xl border border-slate-200 px-3 py-2 pr-10 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
              placeholder={t('password_placeholder')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label={showPassword ? t('hide_password') : t('show_password')}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          <Button fullWidth disabled={isLoading}>
            {isLoading ? t('logging_in') : t('login')}
          </Button>
        </form>
        <a
          href={buildApiUrl('/api/v1/download/app')}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {t('download_mobile_app')}
        </a>
      </Card>
    </div>
  )
}
