import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { AdminLayout } from '../../../admin/components/AdminLayout'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { createUser } from '../../../services/usersApi'
import type { UserRole } from '../../../types/users'

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'warehouse_admin', label: 'Warehouse Admin' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'picker', label: 'Picker' },
  { value: 'receiver', label: 'Receiver' },
  { value: 'inventory_controller', label: 'Inventory Controller' },
]

export function UserCreatePage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('picker')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password !== confirmPassword) {
      setError('Parollar mos emas.')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const created = await createUser({
        username: username.trim(),
        full_name: fullName.trim() || null,
        password,
        role,
        is_active: isActive,
      })
      navigate(`/admin/users/${created.id}`, { replace: true })
    } catch (err) {
      setError('User yaratilmadi. Parol kuchli ekanini tekshiring.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AdminLayout title="Create user">
      <Card className="max-w-xl p-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="text-sm font-semibold text-slate-700">Username</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
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
          <div>
            <label className="text-sm font-semibold text-slate-700">Password</label>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-700">Confirm password</label>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
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
              {isSaving ? 'Saving...' : 'Create user'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/admin/users')}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </AdminLayout>
  )
}
