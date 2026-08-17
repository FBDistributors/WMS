export type UserRole =
  | 'warehouse_admin'
  | 'supervisor'
  | 'picker'
  | 'inventory_controller'

export type UserRecord = {
  id: string
  code?: string | null
  username: string
  full_name?: string | null
  role: UserRole
  /** Xodim (shaxs) kodi — bitta odamning barcha profillari bir xil kod oladi (to'rt ko'z qoidasi). */
  person_code?: string | null
  is_active: boolean
  created_at: string
  last_login_at?: string | null
  granted_permissions?: string[]
}

export type UsersListResponse = {
  items: UserRecord[]
  total: number
  limit: number
  offset: number
}

export type CreateUserPayload = {
  username: string
  full_name?: string | null
  password: string
  role: UserRole
  person_code?: string | null
  is_active: boolean
}

export type UpdateUserPayload = {
  username?: string
  full_name?: string | null
  role?: UserRole
  person_code?: string | null
  is_active?: boolean
  granted_permissions?: string[] | null
}

export type ResetPasswordPayload = {
  new_password: string
}
