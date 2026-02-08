export type UserRole =
  | 'warehouse_admin'
  | 'supervisor'
  | 'picker'
  | 'receiver'
  | 'inventory_controller'

export type UserRecord = {
  id: string
  username: string
  full_name?: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  last_login_at?: string | null
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
  is_active: boolean
}

export type UpdateUserPayload = {
  full_name?: string | null
  role?: UserRole
  is_active?: boolean
}

export type ResetPasswordPayload = {
  new_password: string
}
