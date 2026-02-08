import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '../components/ui/EmptyState'

type NotAuthorizedProps = {
  onBack?: () => void
  onHome?: () => void
  onLogin?: () => void
}

export function NotAuthorized({ onBack, onHome, onLogin }: NotAuthorizedProps) {
  const { t } = useTranslation('common')
  return (
    <div className="mx-auto max-w-lg">
      <EmptyState
        icon={<ShieldAlert size={32} />}
        title={t('messages.not_authorized_title')}
        description={t('messages.not_authorized_desc')}
        actionLabel={onHome ? t('buttons.home') : undefined}
        onAction={onHome}
      />
      {(onBack || onLogin) ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            {t('buttons.back')}
          </button>
          {onLogin ? (
            <button
              type="button"
              onClick={onLogin}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              {t('buttons.login')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
