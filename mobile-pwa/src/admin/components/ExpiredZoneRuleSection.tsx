import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import { useAppToast } from '../../feedback/useAppToast'
import {
  getExpiredZoneRule,
  getSaleExpiryCutoff,
  saveExpiredZoneRule,
} from '../../services/appSettingsApi'

/**
 * EXPIRED zona oddiy buyurtmalarda: yoqilganda oddiy qatorlar ham shu zonadan
 * ajratiladi (NORMAL'dan oldin). Muddati o'tgan tovar baribir chiqmaydi.
 *
 * Sotuv muddat chegarasi ham o'qiladi — ikkalasi yoqilgan bo'lsa qoida amalda
 * ishlamay qolishi mumkin, admin buni ko'rib turishi kerak.
 */
export function ExpiredZoneRuleSection() {
  const { t } = useTranslation(['admin', 'common'])
  const { showError, showSuccess } = useAppToast()
  const [enabled, setEnabled] = useState(false)
  const [cutoff, setCutoff] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [rule, cut] = await Promise.all([getExpiredZoneRule(), getSaleExpiryCutoff()])
      setEnabled(rule.enabled)
      setCutoff(cut.cutoff)
    } catch {
      showError(t('admin:expired_zone_rule.load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (next: boolean) => {
    setIsSaving(true)
    try {
      const data = await saveExpiredZoneRule(next)
      setEnabled(data.enabled)
      showSuccess(t('admin:expired_zone_rule.saved'))
    } catch {
      showError(t('admin:expired_zone_rule.save_failed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-[22px] dark:border-slate-800 dark:bg-slate-900">
      <div className="text-base font-extrabold tracking-[-0.3px] text-slate-900 dark:text-slate-100">
        {t('admin:expired_zone_rule.title')}
      </div>
      <div className="text-[12.5px] font-medium text-slate-400 dark:text-slate-500">
        {t('admin:expired_zone_rule.subtitle')}
      </div>

      <label className="mt-4 flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300"
          checked={enabled}
          disabled={isLoading || isSaving}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span className="font-medium">{t('admin:expired_zone_rule.checkbox')}</span>
      </label>

      <p className="mt-2 max-w-2xl text-[11.5px] leading-relaxed text-slate-400 dark:text-slate-500">
        {t('admin:expired_zone_rule.hint')}
      </p>

      {enabled && cutoff ? (
        <div className="mt-3 flex max-w-2xl items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/30">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          <span className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-200">
            {t('admin:expired_zone_rule.conflict_warning', { date: cutoff })}
          </span>
        </div>
      ) : null}
    </div>
  )
}
