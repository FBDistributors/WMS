import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { ROLE_PERMISSIONS, type PermissionKey, type Role } from './permissions'

type User = {
  id: string
  name: string
  role: Role
}

type AuthContextValue = {
  user: User
  hasPermission: (permission: PermissionKey) => boolean
  setRole: (role: Role) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const DEFAULT_USER: User = {
  id: 'mock-user',
  name: 'Operator',
  role: 'admin',
}

const ROLE_STORAGE_KEY = 'wms.role'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(DEFAULT_USER)

  useEffect(() => {
    const stored = localStorage.getItem(ROLE_STORAGE_KEY) as Role | null
    if (stored && ROLE_PERMISSIONS[stored]) {
      setUser((prev) => ({ ...prev, role: stored }))
    }
  }, [])

  const setRole = (role: Role) => {
    localStorage.setItem(ROLE_STORAGE_KEY, role)
    setUser((prev) => ({ ...prev, role }))
  }

  const hasPermission = (permission: PermissionKey) => {
    return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false
  }

  const value = useMemo(
    () => ({
      user,
      hasPermission,
      setRole,
    }),
    [user]
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
