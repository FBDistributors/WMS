import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { useAuth } from '../rbac/AuthProvider'
import { getHomeRouteForRole } from '../rbac/routes'

export function LoginPage() {
  const { signIn, user, isLoading: isAuthLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isSubmittingRef = useRef(false)

  const from = (location.state as { from?: Location })?.from?.pathname

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
    isSubmittingRef.current = true
    try {
      const nextUser = await signIn(username, password)
      const home = getHomeRouteForRole(nextUser.role)
      const shouldUseFrom =
        from &&
        ((home === '/admin' && from.startsWith('/admin')) ||
          (home === '/picking/mobile-pwa' && from.startsWith('/picking')))
      navigate(shouldUseFrom ? from : home, { replace: true })
    } catch {
      setError('Login yoki parol noto‘g‘ri.')
    } finally {
      setIsLoading(false)
      isSubmittingRef.current = false
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold text-slate-900">WMS Login</h1>
        <p className="mt-1 text-sm text-slate-500">Ombor tizimiga kirish</p>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          <input
            type="password"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          <Button fullWidth disabled={isLoading}>
            {isLoading ? 'Kirilmoqda...' : 'Kirish'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
