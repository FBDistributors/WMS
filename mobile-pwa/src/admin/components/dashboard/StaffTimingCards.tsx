import { useTranslation } from 'react-i18next'

import { LoadingOverlay } from '../../../components/ui/LoadingOverlay'
import { formatDuration } from '../../../lib/formatDuration'
import type {
  StaffTimingControllerRow,
  StaffTimingPickerRow,
} from '../../../services/dashboardApi'

type StaffTimingCardsProps = {
  pickers: StaffTimingPickerRow[]
  controllers: StaffTimingControllerRow[]
  isLoading: boolean
}

const CARD_CLS =
  'rounded-[20px] border border-slate-200 bg-white p-[22px] dark:border-slate-800 dark:bg-slate-900'
const TH_CLS =
  'px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'
const TD_CLS = 'px-2 py-2.5 text-sm text-slate-900 dark:text-slate-100'

export function StaffTimingCards({ pickers, controllers, isLoading }: StaffTimingCardsProps) {
  const { t } = useTranslation(['admin'])
  const units = {
    h: t('admin:dashboard.timing.h'),
    m: t('admin:dashboard.timing.m'),
    s: t('admin:dashboard.timing.s'),
  }
  const fmt = (s: number | null | undefined) => formatDuration(s, units)

  const dual = (avg: number, median: number) => (
    <div className="text-right tabular-nums">
      <div className="font-semibold">{fmt(avg)}</div>
      <div className="text-[11px] text-slate-400">
        {t('admin:dashboard.timing.median_short')}: {fmt(median)}
      </div>
    </div>
  )

  const empty = <p className="py-6 text-center text-sm text-slate-400">{t('admin:dashboard.staff_stats_empty')}</p>

  return (
    <div className="grid grid-cols-1 gap-[22px] lg:grid-cols-2">
      {/* Yig'uvchilar — yig'ish vaqti */}
      <div className={CARD_CLS}>
        <div className="mb-1 text-base font-extrabold tracking-[-0.3px] text-slate-900 dark:text-slate-100">
          {t('admin:dashboard.timing.pickers_title')}
        </div>
        <div className="mb-3 text-[13px] font-medium text-slate-400">
          {t('admin:dashboard.timing.pickers_sub')}
        </div>
        <div className="relative min-h-[6rem] overflow-x-auto">
          {isLoading ? (
            <LoadingOverlay label="" />
          ) : pickers.length === 0 ? (
            empty
          ) : (
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className={TH_CLS}>{t('admin:dashboard.timing.col_staff')}</th>
                  <th className={`${TH_CLS} text-right`}>{t('admin:dashboard.timing.col_avg')}</th>
                  <th className={`${TH_CLS} text-right`}>{t('admin:dashboard.timing.col_orders')}</th>
                </tr>
              </thead>
              <tbody>
                {pickers.map((r) => (
                  <tr key={r.user_id} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className={`${TD_CLS} font-medium`}>{r.full_name}</td>
                    <td className={`${TD_CLS} text-right`}>{dual(r.avg_seconds, r.median_seconds)}</td>
                    <td className={`${TD_CLS} text-right tabular-nums text-slate-500`}>{r.orders_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Controllerlar — tekshirish vaqti */}
      <div className={CARD_CLS}>
        <div className="mb-1 text-base font-extrabold tracking-[-0.3px] text-slate-900 dark:text-slate-100">
          {t('admin:dashboard.timing.controllers_title')}
        </div>
        <div className="mb-3 text-[13px] font-medium text-slate-400">
          {t('admin:dashboard.timing.controllers_sub')}
        </div>
        <div className="relative min-h-[6rem] overflow-x-auto">
          {isLoading ? (
            <LoadingOverlay label="" />
          ) : controllers.length === 0 ? (
            empty
          ) : (
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className={TH_CLS}>{t('admin:dashboard.timing.col_staff')}</th>
                  <th className={`${TH_CLS} text-right`}>{t('admin:dashboard.timing.col_total')}</th>
                  <th className={`${TH_CLS} text-right`}>{t('admin:dashboard.timing.col_check')}</th>
                  <th className={`${TH_CLS} text-right`}>{t('admin:dashboard.timing.col_orders')}</th>
                </tr>
              </thead>
              <tbody>
                {controllers.map((r) => (
                  <tr key={r.user_id} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className={`${TD_CLS} font-medium`}>{r.full_name}</td>
                    <td className={`${TD_CLS} text-right`}>
                      {dual(r.total_avg_seconds, r.total_median_seconds)}
                    </td>
                    <td className={`${TD_CLS} text-right`}>
                      {r.check_count > 0 ? dual(r.check_avg_seconds, r.check_median_seconds) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={`${TD_CLS} text-right tabular-nums text-slate-500`}>{r.orders_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
