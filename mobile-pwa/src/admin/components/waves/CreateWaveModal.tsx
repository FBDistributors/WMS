import { useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import type { OrderListItem } from '../../../services/ordersApi'

type CreateWaveModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (orderIds: string[], note?: string) => Promise<void>
  loadOrders: (dateFrom: string, dateTo: string) => Promise<OrderListItem[]>
}

export function CreateWaveModal({
  open,
  onOpenChange,
  onCreate,
  loadOrders,
}: CreateWaveModalProps) {
  const { t } = useTranslation(['admin', 'orders'])
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date()
    return d.toISOString().slice(0, 10)
  })
  const [orders, setOrders] = useState<OrderListItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [isLoadingOrders, setIsLoadingOrders] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const handleLoadOrders = useCallback(async () => {
    if (!dateFrom || !dateTo) return
    setIsLoadingOrders(true)
    setLoadError(null)
    try {
      const items = await loadOrders(dateFrom, dateTo)
      setOrders(items)
      setSelectedIds(new Set())
    } catch {
      setLoadError(t('orders:load_failed'))
    } finally {
      setIsLoadingOrders(false)
    }
  }, [dateFrom, dateTo, loadOrders, t])

  const handleSubmit = useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setIsCreating(true)
    try {
      await onCreate(ids, note || undefined)
      onOpenChange(false)
      setNote('')
      setSelectedIds(new Set())
    } finally {
      setIsCreating(false)
    }
  }, [note, onCreate, onOpenChange, selectedIds])

  const toggleOrder = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIds.size === orders.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(orders.map((o) => o.id)))
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('admin:waves.create_modal_title')}
          </h2>
          <button
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            onClick={() => onOpenChange(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('admin:waves.date_from')}
              <input
                type="date"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('admin:waves.date_to')}
              <input
                type="date"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
          </div>

          <Button
            variant="secondary"
            onClick={handleLoadOrders}
            disabled={isLoadingOrders}
            className="w-full"
          >
            {isLoadingOrders ? t('admin:waves.loading_orders') : t('admin:waves.load_orders')}
          </Button>

          {loadError && (
            <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {loadError}
            </div>
          )}

          {orders.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {t('admin:waves.select_orders')}
                </span>
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                  onClick={toggleAll}
                >
                  {selectedIds.size === orders.length ? 'Deselect all' : t('orders:select_all')}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                    <tr>
                      <th className="w-10 px-2 py-2 text-left" />
                      <th className="px-2 py-2 text-left">{t('orders:columns.order_number')}</th>
                      <th className="px-2 py-2 text-left">{t('orders:columns.external_id')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr
                        key={order.id}
                        className="border-t border-slate-100 dark:border-slate-800"
                      >
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(order.id)}
                            onChange={() => toggleOrder(order.id)}
                            className="h-4 w-4 rounded"
                          />
                        </td>
                        <td className="px-2 py-2 font-medium">{order.order_number}</td>
                        <td className="px-2 py-2 text-slate-500">{order.source_external_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {orders.length === 0 && !isLoadingOrders && dateFrom && dateTo && (
            <div className="rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {t('admin:waves.no_orders')}
            </div>
          )}

          <label className="block text-sm text-slate-600 dark:text-slate-300">
            {t('admin:waves.note')}
            <input
              type="text"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('admin:waves.note')}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:buttons.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={selectedIds.size === 0 || isCreating}
          >
            {isCreating ? t('admin:waves.creating') : t('admin:waves.create')}
          </Button>
        </div>
      </div>
    </div>
  )
}
