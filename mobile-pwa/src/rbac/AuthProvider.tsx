import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { ROLE_PERMISSIONS, type PermissionKey, type Role } from './permissions'

type User = {
  id: string
  name: string
  role: Role
  permissions: PermissionKey[]
}

type AuthContextValue = {
  user: User
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
  const [user, setUser] = useState<User>(DEFAULT_USER)

  useEffect(() => {
    const stored = localStorage.getItem(ROLE_STORAGE_KEY) as Role | null
    if (stored && ROLE_PERMISSIONS[stored]) {
      setUser((prev) => ({
        ...prev,
        role: stored,
        permissions: ROLE_PERMISSIONS[stored],
      }))
    }
  }, [])

  const setRole = (role: Role) => {
    localStorage.setItem(ROLE_STORAGE_KEY, role)
    setUser((prev) => ({
      ...prev,
      role,
      permissions: ROLE_PERMISSIONS[role],
    }))
  }

  const has = (permission: PermissionKey) => {
    return user.permissions.includes(permission)
  }

  const value = useMemo(
    () => ({
      user,
      setRole,
      has,
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
