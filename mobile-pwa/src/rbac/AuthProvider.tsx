import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { getMe, login as loginRequest, logout as logoutRequest, clearToken, getToken } from '../services/authApi'
import {
  ROLE_PERMISSIONS,
  isInventoryController,
  isPicker,
  isReceiver,
  isSupervisor,
  isWarehouseAdmin,
  normalizePermissions,
  type PermissionKey,
  type Role,
} from './permissions'

type User = {
  id: string
  name: string
  username: string
  full_name?: string | null
  role: Role
  permissions: PermissionKey[]
}

type AuthContextValue = {
  user: User | null
  isLoading: boolean
  isMock: boolean
  isPicker: boolean
  isReceiver: boolean
  isInventoryController: boolean
  isSupervisor: boolean
  isWarehouseAdmin: boolean
  signIn: (username: string, password: string) => Promise<User>
  signOut: () => void
  login: (username: string, password: string) => Promise<User>
  logout: () => void
  setRole: (role: Role) => void
  has: (permission: PermissionKey) => boolean
  can: (permission: PermissionKey) => boolean
  hasAny: (permissions: PermissionKey[]) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const DEFAULT_USER: User = {
  id: 'mock-user',
  name: 'Operator',
  username: 'operator',
  role: 'warehouse_admin',
  permissions: ROLE_PERMISSIONS.warehouse_admin,
}

const ROLE_STORAGE_KEY = 'wms_role'
const ALLOW_MOCK_AUTH =
  import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK_AUTH === 'true'

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
            name: me.full_name || me.username,
            username: me.username,
            full_name: me.full_name,
            role: me.role as Role,
            permissions: normalizePermissions(me.permissions),
          })
        } catch {
          clearToken()
          setUser(null)
        } finally {
          setIsLoading(false)
        }
        return
      }

      if (ALLOW_MOCK_AUTH) {
        const stored = localStorage.getItem(ROLE_STORAGE_KEY) as Role | null
        const role = stored && ROLE_PERMISSIONS[stored] ? stored : 'warehouse_admin'
        setUser({ ...DEFAULT_USER, role, permissions: ROLE_PERMISSIONS[role] })
        setIsMock(true)
      }
      setIsLoading(false)
    }
    void init()
  }, [])

  const setRole = (role: Role) => {
    if (!ALLOW_MOCK_AUTH) return
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
    if (!user) return false
    if (user.permissions.includes(permission)) return true
    return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false
  }

  const hasAny = (permissions: PermissionKey[]) => {
    if (!user) return false
    return permissions.some((permission) => has(permission))
  }

  const signIn = async (username: string, password: string) => {
    await loginRequest(username, password)
    const me = await getMe()
    const nextUser = {
      id: me.id,
      name: me.full_name || me.username,
      username: me.username,
      full_name: me.full_name,
      role: me.role as Role,
      permissions: normalizePermissions(me.permissions),
    }
    setUser(nextUser)
    setIsMock(false)
    return nextUser
  }

  const signOut = async () => {
    await logoutRequest()
    setUser(null)
  }

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isMock,
      isPicker: user ? isPicker(user.role) : false,
      isReceiver: user ? isReceiver(user.role) : false,
      isInventoryController: user ? isInventoryController(user.role) : false,
      isSupervisor: user ? isSupervisor(user.role) : false,
      isWarehouseAdmin: user ? isWarehouseAdmin(user.role) : false,
      signIn,
      signOut,
      login: signIn,
      logout: signOut,
      setRole,
      has,
      can: has,
      hasAny,
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
