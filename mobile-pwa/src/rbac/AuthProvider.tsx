import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { getMe, login as loginRequest, clearToken, getToken } from '../services/authApi'
import { ROLE_PERMISSIONS, type PermissionKey, type Role } from './permissions'

type User = {
  id: string
  name: string
  role: Role
  permissions: PermissionKey[]
}

type AuthContextValue = {
  user: User | null
  isLoading: boolean
  isMock: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  setRole: (role: Role) => void
  has: (permission: PermissionKey) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const DEFAULT_USER: User = {
  id: 'mock-user',
  name: 'Operator',
  role: 'admin',
  permissions: ROLE_PERMISSIONS.admin,
}

const ROLE_STORAGE_KEY = 'wms_role'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isMock, setIsMock] = useState(false)

  useEffect(() => {
    const init = async () => {
      const token = getToken()
      if (token) {
        try {
          const me = await getMe()
          setUser({
            id: me.id,
            name: me.username,
            role: me.role as Role,
            permissions: me.permissions as PermissionKey[],
          })
        } catch {
          clearToken()
          setUser(null)
        } finally {
          setIsLoading(false)
        }
        return
      }

      if (import.meta.env.DEV) {
        const stored = localStorage.getItem(ROLE_STORAGE_KEY) as Role | null
        const role = stored && ROLE_PERMISSIONS[stored] ? stored : 'admin'
        setUser({ ...DEFAULT_USER, role, permissions: ROLE_PERMISSIONS[role] })
        setIsMock(true)
      }
      setIsLoading(false)
    }
    void init()
  }, [])

  const setRole = (role: Role) => {
    if (!import.meta.env.DEV) return
    localStorage.setItem(ROLE_STORAGE_KEY, role)
    setUser((prev) =>
      prev
        ? {
            ...prev,
            role,
            permissions: ROLE_PERMISSIONS[role],
          }
        : { ...DEFAULT_USER, role, permissions: ROLE_PERMISSIONS[role] }
    )
    setIsMock(true)
  }

  const has = (permission: PermissionKey) => {
    return user?.permissions.includes(permission) ?? false
  }

  const login = async (username: string, password: string) => {
    await loginRequest(username, password)
    const me = await getMe()
    setUser({
      id: me.id,
      name: me.username,
      role: me.role as Role,
      permissions: me.permissions as PermissionKey[],
    })
    setIsMock(false)
  }

  const logout = () => {
    clearToken()
    setUser(null)
  }

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isMock,
      login,
      logout,
      setRole,
      has,
    }),
    [user, isLoading, isMock]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
