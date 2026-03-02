import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Progress } from '../../components/ui/progress'
import type { ActivePick } from '../../types/dashboard'
import { useTranslation } from 'react-i18next'

const statusVariant: Record<string, 'neutral' | 'primary' | 'success'> = {
  new: 'neutral',
  in_progress: 'primary',
  partial: 'primary',
  picked: 'primary',
  completed: 'success',
}

function getStatusKey(status: string): string {
  const key = status.toLowerCase().replace(/-/g, '_')
  return `admin:active_picks.status_${key}`
}

type ActivePickListProps = {
  items: ActivePick[]
  onOpen: (id: string) => void
}

export function ActivePickList({ items, onOpen }: ActivePickListProps) {
  const { t } = useTranslation(['admin', 'common'])
  if (items.length === 0) {
    return (
      <Card>
        <div className="text-sm text-slate-500 dark:text-slate-400">{t('admin:active_picks.empty')}</div>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const percent = item.total > 0 ? Math.round((item.picked / item.total) * 100) : 0
        const statusKey = getStatusKey(item.status)
        const variant = statusVariant[item.status] ?? 'neutral'
        return (
          <Card key={item.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.document_no}</div>
              <Badge variant={variant}>
                {t(statusKey)}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>
                {t('admin:active_picks.picked', { picked: item.picked, total: item.total })}
              </span>
              <span>{percent}%</span>
            </div>
            {(item.picker_name != null || item.controller_name != null) && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                {item.picker_name != null && (
                  <span title={t('admin:active_picks.picker')}>
                    {t('admin:active_picks.picker')}: <strong>{item.picker_name}</strong>
                  </span>
                )}
                {item.controller_name != null && (
                  <span title={t('admin:active_picks.controller')}>
                    {t('admin:active_picks.controller')}: <strong>{item.controller_name}</strong>
                  </span>
                )}
              </div>
            )}
            <Progress value={percent} />
            <div className="pt-1">
              <Button variant="outline" onClick={() => onOpen(item.id)}>
                {t('admin:active_picks.open')}
              </Button>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
