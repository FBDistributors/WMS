import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import i18n from 'i18next'
import { PackageSearch } from 'lucide-react'

import { TableScrollArea } from '../TableScrollArea'
import { Badge } from '../ui/badge'
import { EmptyState } from '../ui/EmptyState'
import { LoadingOverlay } from '../ui/LoadingOverlay'
import {
  getPickListDetailsForPicker,
  type PickListDetails,
  type PickLine,
  type PickListStatus,
  formatPickingSkipReason,
  lineStatusBadgeLabel,
} from '../../services/pickingApi'

const lineStatusVariant: Record<PickLine['status'], 'neutral' | 'primary' | 'success' | 'danger'> = {
  NEW: 'neutral',
  IN_PROGRESS: 'primary',
  DONE: 'success',
  NOT_PICKED: 'danger',
  ERROR: 'danger',
}

function lineReasonNote(line: PickLine, t: TFunction): string | null {
  if (line.is_vip_expiry_informational) return null
  if (line.skip_reason?.trim()) {
    const reason = formatPickingSkipReason(line.skip_reason, t) ?? line.skip_reason
    return t('picking:line_skip_reason', { reason })
  }
  if (line.status === 'NOT_PICKED') return t('picking:line_not_picked_hint')
  return null
}

type PickListReadOnlyDetailProps = {
  documentId: string
}

export function PickListReadOnlyDetail({ documentId }: PickListReadOnlyDetailProps) {
  const { t } = useTranslation(['picking', 'common'])
  const [data, setData] = useState<PickListDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadIdRef = useRef(0)

  const load = useCallback(async () => {
    const id = (loadIdRef.current += 1)
    setIsLoading(true)
    setError(null)
    try {
      const details = await getPickListDetailsForPicker(documentId)
      if (id !== loadIdRef.current) return
      setData(details)
    } catch {
      if (id !== loadIdRef.current) return
      setError(t('picking:load_failed'))
    } finally {
      if (id === loadIdRef.current) setIsLoading(false)
    }
  }, [documentId, t])

  useEffect(() => {
    void load()
  }, [load])

  const pipelineBadgeClass = (status: PickListStatus): string => {
    switch (status) {
      case 'DONE':
        return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
      case 'IN_PROGRESS':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
      case 'REVIEW':
        return 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
      case 'ERROR':
        return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
      case 'RETURNING':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200'
      default:
        return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
    }
  }

  const pipelineLabel = (status: PickListStatus) =>
    t(`picking:status.${String(status).toLowerCase()}`, { defaultValue: status })

  const formatDateTime = (iso?: string | null) => {
    if (!iso?.trim()) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })
  }

  if (isLoading) {
    return (
      <div className="relative min-h-[240px]">
        <LoadingOverlay label={t('common:messages.loading')} />
      </div>
    )
  }

  if (!data || error) {
    return (
      <EmptyState
        icon={<PackageSearch size={32} />}
        title={error ?? t('picking:document_not_found')}
        actionLabel={t('picking:refresh')}
        onAction={load}
      />
    )
  }

  const title = data.order_number
    ? t('picking:order_title_plain', { number: data.order_number })
    : t('picking:document_number', { number: data.document_no })

  const showMetaGrid =
    Boolean(data.customer_id?.trim()) ||
    Boolean(data.customer_name?.trim()) ||
    Boolean(data.picker_name?.trim()) ||
    Boolean(data.controller_name?.trim()) ||
    Boolean(data.sent_to_controller_at?.trim()) ||
    Boolean(data.completed_at?.trim()) ||
    Boolean(data.first_assigned_at?.trim())

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
          {showMetaGrid ? (
            <div className="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900/50 sm:grid-cols-2">
              <div className="min-w-0">
                <span className="text-slate-500 dark:text-slate-400">{t('picking:column_customer_id')}: </span>
                <span className="font-mono text-slate-900 dark:text-slate-100">
                  {data.customer_id?.trim() || '—'}
                </span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 dark:text-slate-400">{t('picking:column_customer_name')}: </span>
                <span className="break-words text-slate-900 dark:text-slate-100">
                  {data.customer_name?.trim() || '—'}
                </span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 dark:text-slate-400">{t('picking:column_picker')}: </span>
                <span className="text-slate-900 dark:text-slate-100">{data.picker_name?.trim() || '—'}</span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 dark:text-slate-400">
                  {t('picking:column_sent_to_picker')}:{' '}
                </span>
                <span className="text-slate-900 dark:text-slate-100">
                  {formatDateTime(data.first_assigned_at)}
                </span>
              </div>
              {data.last_assigned_at?.trim() ? (
                <div className="min-w-0">
                  <span className="text-slate-500 dark:text-slate-400">
                    {t('picking:column_picker_reassigned')}:{' '}
                  </span>
                  <span className="text-slate-900 dark:text-slate-100">
                    {formatDateTime(data.last_assigned_at)}
                  </span>
                </div>
              ) : null}
              <div className="min-w-0">
                <span className="text-slate-500 dark:text-slate-400">{t('picking:column_controller')}: </span>
                <span className="text-slate-900 dark:text-slate-100">{data.controller_name?.trim() || '—'}</span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 dark:text-slate-400">{t('picking:sent_to_controller_at')}: </span>
                <span className="text-slate-900 dark:text-slate-100">
                  {formatDateTime(data.sent_to_controller_at)}
                </span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 dark:text-slate-400">{t('picking:controller_completed_at')}: </span>
                <span className="text-slate-900 dark:text-slate-100">{formatDateTime(data.completed_at)}</span>
              </div>
            </div>
          ) : null}
        </div>
        <span
          className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${pipelineBadgeClass(data.status)}`}
        >
          {pipelineLabel(data.status)}
        </span>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('picking:lines_title')}
        </h2>
        <TableScrollArea inline>
          <table className="w-max min-w-full text-sm">
            <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('picking:product_label')}</th>
                <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('picking:location_label')}</th>
                <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('picking:column_sku')}</th>
                <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('picking:expiry_label')}</th>
                <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('picking:qty')}</th>
                <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                  {t('picking:column_picked_at')}
                </th>
                <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('picking:status_label')}</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line) => {
                const reasonNote = lineReasonNote(line, t)
                return (
                <tr key={line.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="max-w-[min(360px,40vw)] px-3 py-3 text-slate-900 dark:text-slate-100 sm:px-4">
                    <div className="font-medium">{line.product_name}</div>
                    {line.is_vip_expiry_informational ? (
                      <p className="mt-1 text-xs text-red-700 dark:text-red-300">{t('picking:vip_expiry_not_picked')}</p>
                    ) : null}
                    {reasonNote ? (
                      <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">{reasonNote}</p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-700 dark:text-slate-300 sm:px-4">
                    {line.location_code}
                  </td>
                  <td
                    className="max-w-[140px] truncate px-3 py-3 text-slate-600 dark:text-slate-400 sm:px-4"
                    title={line.sku ?? line.barcode ?? ''}
                  >
                    {line.sku ?? line.barcode ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-700 dark:text-slate-300 sm:px-4">
                    {line.expiry_date?.trim() ? line.expiry_date : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-800 dark:text-slate-200 sm:px-4">
                    {line.qty_picked}/{line.qty_required}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-700 dark:text-slate-300 sm:px-4">
                    {formatDateTime(line.picked_at)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 sm:px-4">
                    <Badge variant={lineStatusVariant[line.status]}>
                      {lineStatusBadgeLabel(line, t)}
                    </Badge>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </TableScrollArea>
      </div>
    </div>
  )
}
