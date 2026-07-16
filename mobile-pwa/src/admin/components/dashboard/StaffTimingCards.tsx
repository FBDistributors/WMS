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

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

export function StaffTimingCards({ pickers, controllers, isLoading }: StaffTimingCardsProps) {
  const { t } = useTranslation(['admin'])
  const units = {
    h: t('admin:dashboard.timing.h'),
    m: t('admin:dashboard.timing.m'),
    s: t('admin:dashboard.timing.s'),
  }
  const fmtDur = (s: number | null | undefined) => formatDuration(s, units)

  const throughput = (unitsPerHour: number, posPerHour: number) => (
    <div className="text-right tabular-nums">
      <div className="font-semibold">
        {fmtNum(unitsPerHour)}{' '}
        <span className="text-[11px] font-normal text-slate-400">
          {t('admin:dashboard.timing.unit_per_hour')}
        </span>
      </div>
      <div className="text-[11px] text-slate-400">
        {fmtNum(posPerHour)} {t('admin:dashboard.timing.pos_per_hour')}
      </div>
    </div>
  )

  const empty = (
    <p className="py-6 text-center text-sm text-slate-400">
      {t('admin:dashboard.staff_stats_empty')}
    </p>
  )

  return (
    <div className="grid grid-cols-1 gap-[22px] lg:grid-cols-2">
      {/* Yig'uvchilar — unumdorlik */}
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
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className={TH_CLS}>{t('admin:dashboard.timing.col_staff')}</th>
                  <th className={`${TH_CLS} text-right`}>{t('admin:dashboard.timing.col_throughput')}</th>
                  <th className={`${TH_CLS} text-right`}>{t('admin:dashboard.timing.col_median_pick')}</th>
                  <th className={`${TH_CLS} text-right`}>{t('admin:dashboard.timing.col_orders')}</th>
                </tr>
              </thead>
              <tbody>
                {pickers.map((r) => (
                  <tr key={r.user_id} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className={`${TD_CLS} font-medium`}>{r.full_name}</td>
                    <td className={`${TD_CLS} text-right`}>
                      {throughput(r.units_per_hour, r.positions_per_hour)}
                    </td>
                    <td className={`${TD_CLS} text-right tabular-nums text-slate-500 dark:text-slate-400`}>
                      {fmtDur(r.median_seconds)}
                    </td>
                    <td className={`${TD_CLS} text-right tabular-nums text-slate-500`}>{r.orders_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Controllerlar — unumdorlik */}
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
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className={TH_CLS}>{t('admin:dashboard.timing.col_staff')}</th>
                  <th className={`${TH_CLS} text-right`}>{t('admin:dashboard.timing.col_throughput')}</th>
                  <th className={`${TH_CLS} text-right`}>{t('admin:dashboard.timing.col_median_check')}</th>
                  <th className={`${TH_CLS} text-right`}>{t('admin:dashboard.timing.col_orders')}</th>
                </tr>
              </thead>
              <tbody>
                {controllers.map((r) => (
                  <tr key={r.user_id} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className={`${TD_CLS} font-medium`}>{r.full_name}</td>
                    <td className={`${TD_CLS} text-right`}>
                      {r.check_count > 0 ? (
                        throughput(r.units_per_hour, r.positions_per_hour)
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={`${TD_CLS} text-right tabular-nums text-slate-500 dark:text-slate-400`}>
                      {r.check_count > 0 ? fmtDur(r.median_check_seconds) : fmtDur(r.median_total_seconds)}
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
