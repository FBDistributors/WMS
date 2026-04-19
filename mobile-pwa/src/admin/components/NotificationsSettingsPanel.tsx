import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { useAuth } from '../../rbac/AuthProvider'
import {
  getNotificationsPushStatus,
  postNotificationsBroadcast,
  postNotificationsTestSelf,
  type NotificationsPushStatus,
} from '../../services/notificationsApi'

const inputClass =
  'mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100'

export function NotificationsSettingsPanel() {
  const { t } = useTranslation(['admin', 'common'])
  const { has } = useAuth()
  const canUse = has('admin:access')
  const [status, setStatus] = useState<NotificationsPushStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [broadcastTitle, setBroadcastTitle] = useState('')
  const [broadcastBody, setBroadcastBody] = useState('')
  const [broadcastBusy, setBroadcastBusy] = useState(false)
  const [broadcastMessage, setBroadcastMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!canUse) return
    setLoading(true)
    setLoadError(null)
    try {
      const s = await getNotificationsPushStatus()
      setStatus(s)
    } catch {
      setLoadError(t('admin:settings.notifications.load_error'))
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [canUse, t])

  useEffect(() => {
    void load()
  }, [load])

  const onTest = async () => {
    setTestBusy(true)
    setTestMessage(null)
    try {
      const r = await postNotificationsTestSelf()
      setTestMessage(
        r.sent ? t('admin:settings.notifications.test_sent') : t('admin:settings.notifications.test_not_sent'),
      )
      await load()
    } catch {
      setTestMessage(t('admin:settings.notifications.test_error'))
    } finally {
      setTestBusy(false)
    }
  }

  const onBroadcast = async () => {
    const title = broadcastTitle.trim()
    const body = broadcastBody.trim()
    if (!title || !body) {
      setBroadcastMessage(t('admin:settings.notifications.broadcast_empty'))
      return
    }
    const total = status?.total_fcm_tokens_all_users ?? 0
    if (
      total < 1 ||
      !window.confirm(t('admin:settings.notifications.broadcast_confirm', { count: total }))
    ) {
      return
    }
    setBroadcastBusy(true)
    setBroadcastMessage(null)
    try {
      const r = await postNotificationsBroadcast({ title, body })
      setBroadcastMessage(
        t('admin:settings.notifications.broadcast_result', {
          total: r.total_tokens,
          success: r.success,
          failed: r.failed,
        }),
      )
      await load()
    } catch {
      setBroadcastMessage(t('admin:settings.notifications.broadcast_error'))
    } finally {
      setBroadcastBusy(false)
    }
  }

  if (!canUse) {
    return (
      <Card className="max-w-3xl">
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('admin:settings.notifications.no_access')}</p>
      </Card>
    )
  }

  const totalAll = status?.total_fcm_tokens_all_users ?? 0

  return (
    <Card className="max-w-3xl space-y-5 p-1 sm:p-0">
      <div className="space-y-2 px-1 sm:px-0">
        <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {t('admin:settings.notifications.heading')}
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('admin:settings.notifications.intro')}</p>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {loadError}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('admin:settings.notifications.fcm_label')}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {loading ? (
              <span className="text-sm text-slate-500">{t('common:messages.loading')}</span>
            ) : (
              <Badge variant={status?.fcm_server_configured ? 'success' : 'neutral'}>
                {status?.fcm_server_configured
                  ? t('admin:settings.notifications.fcm_ok')
                  : t('admin:settings.notifications.fcm_missing')}
              </Badge>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('admin:settings.notifications.devices_label')}
          </div>
          <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            {loading ? '—' : (status?.registered_devices_for_current_user ?? 0)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('admin:settings.notifications.all_devices_label')}
          </div>
          <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            {loading ? '—' : totalAll}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
        {t('admin:settings.notifications.hint_server')}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
          {t('admin:settings.notifications.refresh')}
        </Button>
        <Button type="button" onClick={() => void onTest()} disabled={testBusy || loading}>
          {t('admin:settings.notifications.test_btn')}
        </Button>
      </div>

      {testMessage ? (
        <div className="text-sm text-slate-700 dark:text-slate-200" role="status">
          {testMessage}
        </div>
      ) : null}

      <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
        <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {t('admin:settings.notifications.broadcast_heading')}
        </div>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
          {t('admin:settings.notifications.broadcast_hint')}
        </p>
        <div className="space-y-3">
          <label className="block text-sm text-slate-600 dark:text-slate-300">
            {t('admin:settings.notifications.broadcast_title')}
            <input
              type="text"
              className={inputClass}
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              maxLength={200}
              disabled={broadcastBusy || loading}
            />
          </label>
          <label className="block text-sm text-slate-600 dark:text-slate-300">
            {t('admin:settings.notifications.broadcast_body')}
            <textarea
              className={`${inputClass} min-h-[100px] resize-y`}
              value={broadcastBody}
              onChange={(e) => setBroadcastBody(e.target.value)}
              maxLength={4000}
              disabled={broadcastBusy || loading}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void onBroadcast()}
            disabled={broadcastBusy || loading || totalAll < 1 || !status?.fcm_server_configured}
          >
            {t('admin:settings.notifications.broadcast_btn')}
          </Button>
        </div>
        {broadcastMessage ? (
          <div className="mt-3 text-sm text-slate-700 dark:text-slate-200" role="status">
            {broadcastMessage}
          </div>
        ) : null}
      </div>
    </Card>
  )
}
