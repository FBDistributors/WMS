import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { useAppToast } from '../../feedback/useAppToast'
import { getSaleExpiryCutoff, saveSaleExpiryCutoff } from '../../services/appSettingsApi'

/**
 * Sotuv muddat chegarasi: muddati shu sanadan OLDIN tugaydigan lotlar oddiy
 * sotuvga chiqmaydi. Promo/aksiya qatorlari bundan mustasno. Bo'sh — qoida o'chiq.
 */
export function SaleExpiryCutoffSection() {
  const { t } = useTranslation(['admin', 'common'])
  const { showError, showSuccess } = useAppToast()
  const [cutoff, setCutoff] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await getSaleExpiryCutoff()
      setCutoff(data.cutoff ?? '')
    } catch {
      showError(t('admin:sale_expiry.load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (value: string | null) => {
    setIsSaving(true)
    try {
      const data = await saveSaleExpiryCutoff(value)
      setCutoff(data.cutoff ?? '')
      showSuccess(t('admin:sale_expiry.saved'))
    } catch {
      showError(t('admin:sale_expiry.save_failed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-[22px] dark:border-slate-800 dark:bg-slate-900">
      <div className="text-base font-extrabold tracking-[-0.3px] text-slate-900 dark:text-slate-100">
        {t('admin:sale_expiry.title')}
      </div>
      <div className="text-[12.5px] font-medium text-slate-400 dark:text-slate-500">
        {t('admin:sale_expiry.subtitle')}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
          {t('admin:sale_expiry.label')}
          <input
            type="date"
            value={cutoff}
            disabled={isLoading}
            onChange={(e) => setCutoff(e.target.value)}
            className="mt-1 block w-[190px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:[color-scheme:dark]"
          />
        </label>
        <Button
          onClick={() => void save(cutoff.trim() || null)}
          disabled={isLoading || isSaving || !cutoff.trim()}
        >
          {isSaving ? t('common:messages.loading') : t('common:buttons.save')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void save(null)}
          disabled={isLoading || isSaving}
        >
          {t('admin:sale_expiry.clear')}
        </Button>
      </div>
      <p className="mt-2 max-w-2xl text-[11.5px] leading-relaxed text-slate-400 dark:text-slate-500">
        {t('admin:sale_expiry.hint')}
      </p>
    </div>
  )
}
