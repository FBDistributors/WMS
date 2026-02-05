import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Progress } from '../../components/ui/progress'
import type { ActivePick } from '../../types/dashboard'

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
  if (items.length === 0) {
    return (
      <Card>
        <div className="text-sm text-slate-500">No active picks right now.</div>
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
              <Badge variant={statusVariant[item.status]}>{item.status}</Badge>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {item.picked}/{item.total} picked
              </span>
              <span>{percent}%</span>
            </div>
            <Progress value={percent} />
            <div className="pt-1">
              <Button variant="outline" onClick={() => onOpen(item.id)}>
                Open
              </Button>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
