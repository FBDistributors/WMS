import { ShieldAlert } from 'lucide-react'

import { EmptyState } from '../components/ui/EmptyState'

type NotAuthorizedProps = {
  onBack?: () => void
  onHome?: () => void
}

export function NotAuthorized({ onBack, onHome }: NotAuthorizedProps) {
  return (
    <div className="mx-auto max-w-lg">
      <EmptyState
        icon={<ShieldAlert size={32} />}
        title="Ruxsat yo‘q"
        description="Bu sahifani ko‘rish uchun ruxsatingiz yetarli emas."
        actionLabel={onHome ? 'Bosh sahifa' : undefined}
        onAction={onHome}
      />
      {onBack ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Orqaga
          </button>
        </div>
      ) : null}
    </div>
  )
}
