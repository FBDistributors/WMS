import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { useAuth } from '../../rbac/AuthProvider'
import {
  getNotificationsPushStatus,
  postNotificationsAppUpdate,
  postNotificationsBroadcast,
  postNotificationsTestSelf,
  type NotificationsPushStatus,
} from '../../services/notificationsApi'

const TITLE_MAX = 200
const BODY_MAX = 4000

const inputClass =
  'mt-1.5 w-full rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none ring-slate-200/80 transition-[box-shadow,border-color] placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-400/25'

const statTileClass =
  'rounded-2xl border border-slate-200/80 bg-gradient-to-b from-slate-50/90 to-white px-4 py-3.5 shadow-sm ring-1 ring-slate-200/40 dark:border-slate-700/80 dark:from-slate-900/60 dark:to-slate-950 dark:ring-slate-800/60'

type Feedback = { text: string; variant: 'success' | 'error' | 'info' }

function feedbackBoxClass(variant: Feedback['variant']) {
  if (variant === 'success') {
    return 'border-emerald-200/90 bg-emerald-50/90 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/35 dark:text-emerald-100'
  }
  if (variant === 'error') {
    return 'border-red-200/90 bg-red-50/90 text-red-950 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-100'
  }
  return 'border-sky-200/90 bg-sky-50/80 text-sky-950 dark:border-sky-900/45 dark:bg-sky-950/30 dark:text-sky-100'
}

export function NotificationsSettingsPanel() {
  const { t } = useTranslation(['admin', 'common'])
  const { has } = useAuth()
  const canUse = has('admin:access')
  const [status, setStatus] = useState<NotificationsPushStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [testFeedback, setTestFeedback] = useState<Feedback | null>(null)
  const [broadcastTitle, setBroadcastTitle] = useState('')
  const [broadcastBody, setBroadcastBody] = useState('')
  const [broadcastBusy, setBroadcastBusy] = useState(false)
  const [broadcastFeedback, setBroadcastFeedback] = useState<Feedback | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)

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
    setTestFeedback(null)
    try {
      const r = await postNotificationsTestSelf()
      setTestFeedback({
        text: r.sent ? t('admin:settings.notifications.test_sent') : t('admin:settings.notifications.test_not_sent'),
        variant: r.sent ? 'success' : 'error',
      })
      await load()
    } catch {
      setTestFeedback({ text: t('admin:settings.notifications.test_error'), variant: 'error' })
    } finally {
      setTestBusy(false)
    }
  }

  const onBroadcast = async () => {
    const title = broadcastTitle.trim()
    const body = broadcastBody.trim()
    if (!title || !body) {
      setBroadcastFeedback({ text: t('admin:settings.notifications.broadcast_empty'), variant: 'error' })
      return
    }
    const total = status?.total_fcm_tokens_all_users ?? 0
    if (total < 1 || !window.confirm(t('admin:settings.notifications.broadcast_confirm', { count: total }))) {
      return
    }
    setBroadcastBusy(true)
    setBroadcastFeedback(null)
    try {
      const r = await postNotificationsBroadcast({ title, body })
      setBroadcastFeedback({
        text: t('admin:settings.notifications.broadcast_result', {
          total: r.total_tokens,
          success: r.success,
          failed: r.failed,
        }),
        variant: 'info',
      })
      await load()
    } catch {
      setBroadcastFeedback({ text: t('admin:settings.notifications.broadcast_error'), variant: 'error' })
    } finally {
      setBroadcastBusy(false)
    }
  }

  const onAppUpdate = async () => {
    const total = status?.total_fcm_tokens_all_users ?? 0
    if (total < 1 || !window.confirm(t('admin:settings.notifications.update_confirm', { count: total }))) {
      return
    }
    setUpdateBusy(true)
    setBroadcastFeedback(null)
    try {
      // Composer'dagi matn to'ldirilgan bo'lsa ishlatiladi; bo'sh bo'lsa backend
      // standart "Ilova yangilandi" matni + Play havolasini yuboradi.
      const r = await postNotificationsAppUpdate({
        title: broadcastTitle.trim() || undefined,
        body: broadcastBody.trim() || undefined,
      })
      setBroadcastFeedback({
        text: t('admin:settings.notifications.broadcast_result', {
          total: r.total_tokens,
          success: r.success,
          failed: r.failed,
        }),
        variant: 'info',
      })
      await load()
    } catch {
      setBroadcastFeedback({ text: t('admin:settings.notifications.broadcast_error'), variant: 'error' })
    } finally {
      setUpdateBusy(false)
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
  const fcmOk = status?.fcm_server_configured ?? false
  const canSend = fcmOk && totalAll >= 1 && !loading

  return (
    <Card className="max-w-3xl space-y-6 border-slate-200/80 bg-white/80 p-4 shadow-md ring-1 ring-slate-200/30 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/40 dark:ring-slate-800/50 sm:p-6">
      <header className="space-y-1.5">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          {t('admin:settings.notifications.heading')}
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {t('admin:settings.notifications.intro')}
        </p>
      </header>

      {loadError ? (
        <div
          className="rounded-xl border border-red-200/90 bg-red-50/90 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
          role="alert"
        >
          {loadError}
        </div>
      ) : null}

      {!loading && status && !fcmOk ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200/90 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100"
          role="status"
        >
          <Badge variant="neutral" className="shrink-0 border-amber-300/80 bg-amber-100/80 text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
            {t('admin:settings.notifications.fcm_missing')}
          </Badge>
          <span>{t('admin:settings.notifications.fcm_disabled_short')}</span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className={statTileClass}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('admin:settings.notifications.fcm_label')}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {loading ? (
              <span className="text-sm text-slate-500">{t('common:messages.loading')}</span>
            ) : (
              <Badge variant={fcmOk ? 'success' : 'neutral'}>{fcmOk ? t('admin:settings.notifications.fcm_ok') : t('admin:settings.notifications.fcm_missing')}</Badge>
            )}
          </div>
        </div>
        <div className={statTileClass}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('admin:settings.notifications.devices_label')}
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {loading ? '—' : (status?.registered_devices_for_current_user ?? 0)}
          </div>
        </div>
        <div className={statTileClass}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('admin:settings.notifications.all_devices_label')}
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">
            {loading ? '—' : totalAll}
          </div>
        </div>
      </div>

      <section
        className="space-y-4 rounded-2xl border border-slate-200/90 bg-gradient-to-b from-white to-slate-50/50 p-5 shadow-sm dark:border-slate-700/90 dark:from-slate-900/50 dark:to-slate-950/80"
        aria-labelledby="notifications-composer-title"
      >
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200/70 pb-3 dark:border-slate-700/70">
          <h3 id="notifications-composer-title" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('admin:settings.notifications.composer_title')}
          </h3>
          <p className="max-w-md text-xs leading-snug text-slate-500 dark:text-slate-400">{t('admin:settings.notifications.broadcast_hint')}</p>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="push-broadcast-title" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('admin:settings.notifications.broadcast_title')}
              </label>
              <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">
                {broadcastTitle.length}/{TITLE_MAX}
              </span>
            </div>
            <input
              id="push-broadcast-title"
              type="text"
              className={inputClass}
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value.slice(0, TITLE_MAX))}
              maxLength={TITLE_MAX}
              disabled={broadcastBusy || loading}
              placeholder={t('admin:settings.notifications.broadcast_title')}
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="push-broadcast-body" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('admin:settings.notifications.broadcast_body')}
              </label>
              <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">
                {broadcastBody.length}/{BODY_MAX}
              </span>
            </div>
            <textarea
              id="push-broadcast-body"
              className={`${inputClass} min-h-[120px] resize-y`}
              value={broadcastBody}
              onChange={(e) => setBroadcastBody(e.target.value.slice(0, BODY_MAX))}
              maxLength={BODY_MAX}
              disabled={broadcastBusy || loading}
              placeholder={t('admin:settings.notifications.broadcast_body')}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200/70 pt-4 dark:border-slate-700/70 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            className="w-full shrink-0 font-semibold shadow-sm sm:w-auto sm:min-w-[220px]"
            onClick={() => void onBroadcast()}
            disabled={broadcastBusy || loading || !canSend}
          >
            {t('admin:settings.notifications.broadcast_btn')}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" className="px-3 py-2 text-xs" onClick={() => void load()} disabled={loading}>
              {t('admin:settings.notifications.refresh')}
            </Button>
            <Button type="button" variant="outline" className="px-3 py-2 text-xs" onClick={() => void onTest()} disabled={testBusy || loading || !fcmOk}>
              {t('admin:settings.notifications.test_btn')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="px-3 py-2 text-xs"
              onClick={() => void onAppUpdate()}
              disabled={updateBusy || broadcastBusy || loading || !canSend}
              title={t('admin:settings.notifications.update_hint')}
            >
              {t('admin:settings.notifications.update_btn')}
            </Button>
          </div>
        </div>
      </section>

      {broadcastFeedback ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${feedbackBoxClass(broadcastFeedback.variant)}`}
          role="status"
        >
          {broadcastFeedback.text}
        </div>
      ) : null}

      {testFeedback ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${feedbackBoxClass(testFeedback.variant)}`} role="status">
          {testFeedback.text}
        </div>
      ) : null}
    </Card>
  )
}
