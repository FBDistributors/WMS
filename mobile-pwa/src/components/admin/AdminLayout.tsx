import type { ReactNode } from 'react'

import { Sidebar } from './Sidebar'

type AdminLayoutProps = {
  title: string
  actionSlot?: ReactNode
  children: ReactNode
}

export function AdminLayout({ title, actionSlot, children }: AdminLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <div className="flex-1">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="text-lg font-semibold text-slate-900">{title}</div>
          <div>{actionSlot}</div>
        </header>
        <main className="px-4 py-6">{children}</main>
      </div>
    </div>
  )
}
