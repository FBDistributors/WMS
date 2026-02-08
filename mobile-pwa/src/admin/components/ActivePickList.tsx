import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Progress } from '../../components/ui/progress'
import type { ActivePick } from '../../types/dashboard'
import { useTranslation } from 'react-i18next'

const statusVariant: Record<ActivePick['status'], 'neutral' | 'primary' | 'success'> = {
  NEW: 'neutral',
  IN_PROGRESS: 'primary',
  DONE: 'success',
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
        <div className="text-sm text-slate-500">{t('admin:active_picks.empty')}</div>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const percent = item.total > 0 ? Math.round((item.picked / item.total) * 100) : 0
        return (
          <Card key={item.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">{item.document_no}</div>
              <Badge variant={statusVariant[item.status]}>
                {t(`common:status.${item.status.toLowerCase()}`)}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {t('admin:active_picks.picked', { picked: item.picked, total: item.total })}
              </span>
              <span>{percent}%</span>
            </div>
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
