import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { AdminLayout } from '../../../admin/components/AdminLayout'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { useAuth } from '../../../rbac/AuthProvider'
import { disableUser, getUser, resetPassword, updateUser } from '../../../services/usersApi'
import type { UserRecord, UserRole } from '../../../types/users'

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'warehouse_admin', label: 'Warehouse Admin' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'picker', label: 'Picker' },
  { value: 'receiver', label: 'Receiver' },
  { value: 'inventory_controller', label: 'Inventory Controller' },
]

export function UserDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user: currentUser } = useAuth()
  const [user, setUser] = useState<UserRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('picker')
  const [isActive, setIsActive] = useState(true)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const isSelf = useMemo(() => currentUser?.id === user?.id, [currentUser, user])

  const load = useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await getUser(id)
      setUser(data)
      setFullName(data.full_name ?? '')
      setRole(data.role)
      setIsActive(data.is_active)
    } catch {
      setError('User yuklanmadi.')
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!user) return
    if (isSelf && (!isActive || role !== 'warehouse_admin')) {
      const confirmed = window.confirm(
        'Bu amal sizni admin huquqidan mahrum qilishi yoki hisobingizni bloklashi mumkin. Davom etasizmi?'
      )
      if (!confirmed) return
    }
    setIsSaving(true)
    setError(null)
    try {
      const updated = await updateUser(user.id, {
        full_name: fullName.trim() || null,
        role,
        is_active: isActive,
      })
      setUser(updated)
    } catch {
      setError('User yangilanmadi.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleResetPassword = async () => {
    if (!user) return
    if (newPassword !== confirmPassword) {
      setError('Parollar mos emas.')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await resetPassword(user.id, { new_password: newPassword })
      setNewPassword('')
      setConfirmPassword('')
      alert('Parol yangilandi.')
    } catch {
      setError('Parol yangilanmadi.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDisable = async () => {
    if (!user) return
    const confirmed = window.confirm('Foydalanuvchini o‘chirib qo‘ymoqchimisiz?')
    if (!confirmed) return
    setIsSaving(true)
    setError(null)
    try {
      const updated = await disableUser(user.id)
      setUser(updated)
      setIsActive(updated.is_active)
    } catch {
      setError('User bloklanmadi.')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <AdminLayout title="User details">
        <div>Yuklanmoqda...</div>
      </AdminLayout>
    )
  }

  if (!user) {
    return (
      <AdminLayout title="User details">
        <div>{error ?? 'User topilmadi.'}</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="User details">
      <Card className="max-w-xl p-6">
        <form className="space-y-4" onSubmit={handleSave}>
          <div>
            <div className="text-sm font-semibold text-slate-700">Username</div>
            <div className="mt-1 text-sm text-slate-600">{user.username}</div>
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-700">Full name</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-700">Role</label>
            <select
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Active
          </label>
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save changes'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/admin/users')}>
              Back
            </Button>
            <Button type="button" variant="ghost" onClick={handleDisable} disabled={isSaving}>
              Disable
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-6 max-w-xl p-6">
        <div className="text-sm font-semibold text-slate-700">Reset password</div>
        <div className="mt-3 space-y-3">
          <input
            type="password"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="New password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <input
            type="password"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <Button type="button" onClick={handleResetPassword} disabled={isSaving}>
            Reset password
          </Button>
        </div>
      </Card>
    </AdminLayout>
  )
}
