import type { ReactNode } from 'react'
import { useState } from 'react'

import { Menu, X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { Button } from '../../components/ui/button'
import { useAuth } from '../../rbac/AuthProvider'

type AdminLayoutProps = {
  title: string
  actionSlot?: ReactNode
  children: ReactNode
}

export function AdminLayout({ title, actionSlot, children }: AdminLayoutProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { user, setRole, isMock } = useAuth()

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <div className="hidden md:block">
        <Sidebar />
      </div>
      {isOpen ? (
        <div className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setIsOpen(false)}>
          <div
            className="h-full w-72 bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">Menu</div>
              <Button variant="ghost" onClick={() => setIsOpen(false)}>
                <X size={18} />
              </Button>
            </div>
            <Sidebar onNavigate={() => setIsOpen(false)} />
          </div>
        </div>
      ) : null}
      <div className="flex-1">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="md:hidden" onClick={() => setIsOpen(true)}>
              <Menu size={18} />
            </Button>
            <div className="text-lg font-semibold text-slate-900">{title}</div>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <div className="hidden text-sm text-slate-500 sm:block">
                {user.name} · {user.role}
              </div>
            ) : null}
            {user && import.meta.env.DEV && isMock ? (
              <select
                className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                value={user.role}
                onChange={(event) => setRole(event.target.value as typeof user.role)}
              >
                <option value="picker">picker</option>
                <option value="receiver">receiver</option>
                <option value="inventory_controller">inventory_controller</option>
                <option value="supervisor">supervisor</option>
                <option value="warehouse_admin">warehouse_admin</option>
              </select>
            ) : null}
            {actionSlot}
          </div>
        </header>
        <main className="px-4 py-6">{children}</main>
      </div>
    </div>
  )
}
