import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import { getPayrollRates, savePayrollRates, type PayrollRate } from '../../services/payrollApi'

const ROLES = ['picker', 'controller'] as const
const GROUPS = ['shahar', 'region'] as const

/**
 * Bitta buyurtma uchun to'lov. Tarif serverda saqlanadi: o'zgartirilgach mobil
 * ilovadagi xodim ham o'sha zahoti yangi summani ko'radi.
 */
export function PayrollRatesSection() {
  const { t } = useTranslation(['admin', 'common'])
  const { showError, showSuccess } = useAppToast()
  const [values, setValues] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [bigOrderThreshold, setBigOrderThreshold] = useState('')

  const keyOf = (role: string, group: string) => `${role}:${group}`

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await getPayrollRates()
      const next: Record<string, string> = {}
      for (const r of data.rates) next[keyOf(r.role, r.source_group)] = String(Math.round(r.amount))
      setValues(next)
      setEffectiveFrom(data.effective_from)
      setBigOrderThreshold(String(Math.round(data.big_order_threshold ?? 0)))
    } catch {
      showError(t('admin:payroll.load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async () => {
    const payload: PayrollRate[] = []
    for (const role of ROLES) {
      for (const group of GROUPS) {
        const raw = (values[keyOf(role, group)] ?? '').trim()
        const amount = Number(raw)
        if (!raw || Number.isNaN(amount) || amount < 0) {
          showError(t('admin:payroll.invalid_amount'))
          return
        }
        payload.push({ role, source_group: group, amount })
      }
    }
    const thresholdRaw = bigOrderThreshold.trim()
    const threshold = Number(thresholdRaw)
    if (!thresholdRaw || Number.isNaN(threshold) || threshold < 0) {
      showError(t('admin:payroll.invalid_amount'))
      return
    }
    setIsSaving(true)
    try {
      const data = await savePayrollRates(payload, threshold)
      setEffectiveFrom(data.effective_from)
      setBigOrderThreshold(String(Math.round(data.big_order_threshold ?? threshold)))
      showSuccess(t('admin:payroll.saved'))
    } catch {
      showError(t('admin:payroll.save_failed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-[22px] dark:border-slate-800 dark:bg-slate-900">
      <div className="text-base font-extrabold tracking-[-0.3px] text-slate-900 dark:text-slate-100">
        {t('admin:payroll.title')}
      </div>
      <div className="text-[12.5px] font-medium text-slate-400 dark:text-slate-500">
        {t('admin:payroll.subtitle')}
      </div>

      {isLoading ? (
        <div className="relative min-h-[140px]">
          <LoadingOverlay />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {ROLES.map((role) => (
            <div key={role}>
              <div className="mb-2 text-[13px] font-bold text-slate-700 dark:text-slate-300">
                {t(`admin:payroll.role_${role}`)}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {GROUPS.map((group) => (
                  <label
                    key={group}
                    className="block text-xs font-medium text-slate-600 dark:text-slate-400"
                  >
                    {t(`admin:payroll.group_${group}`)}
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={values[keyOf(role, group)] ?? ''}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [keyOf(role, group)]: e.target.value }))
                        }
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <span className="shrink-0 text-xs text-slate-400">
                        {t('admin:payroll.currency')}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div>
            <div className="mb-2 text-[13px] font-bold text-slate-700 dark:text-slate-300">
              {t('admin:payroll.big_order_title')}
            </div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {t('admin:payroll.big_order_label')}
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={bigOrderThreshold}
                  onChange={(e) => setBigOrderThreshold(e.target.value)}
                  className="w-full max-w-[240px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <span className="shrink-0 text-xs text-slate-400">
                  {t('admin:payroll.currency')}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                {t('admin:payroll.big_order_hint')}
              </p>
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[11.5px] leading-relaxed text-slate-400 dark:text-slate-500">
              {t('admin:payroll.note', { date: effectiveFrom })}
            </p>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? t('common:messages.loading') : t('common:buttons.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
