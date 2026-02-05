import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import type { ExceptionItem } from '../../types/dashboard'

const statusVariant: Record<ExceptionItem['status'], 'danger' | 'neutral'> = {
  open: 'danger',
  resolved: 'neutral',
}

type ExceptionsListProps = {
  items: ExceptionItem[]
  onView: (id: string) => void
}

export function ExceptionsList({ items, onView }: ExceptionsListProps) {
  if (items.length === 0) {
    return (
      <Card>
        <div className="text-sm text-slate-500">No exceptions reported today.</div>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Card key={item.id} className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              {item.type} · {item.document_no}
            </div>
            <div className="text-xs text-slate-500">
              {item.sku} · {item.location} · {item.time}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant[item.status]}>{item.status}</Badge>
            <Button variant="outline" onClick={() => onView(item.id)}>
              View
            </Button>
          </div>
        </Card>
      ))}
    </div>
  )
}
