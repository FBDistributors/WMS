import { useEffect, useRef, useState } from 'react'

import { getDealerCount, listDealerCounts, type DealerCountOut } from '../../services/dealerCountsApi'

/** Telefonlarda sanalayotgan sanovni web'da kuzatish oralig'i. */
export const DEALER_COUNT_REFRESH_MS = 20_000

/** Qisqa ma'lumot o'zgargan bo'lsa — to'liq sanovni qayta yuklash kerak. */
function changed(a: DealerCountOut, b: DealerCountOut): boolean {
  return (
    a.counted_lines !== b.counted_lines ||
    a.sheet_lines !== b.sheet_lines ||
    a.last_counted_at !== b.last_counted_at ||
    Number(a.total_units) !== Number(b.total_units) ||
    a.is_active !== b.is_active
  )
}

type Options = {
  count: DealerCountOut | null
  /** false — tekshirilmaydi (masalan saqlash ketmoqda yoki oyna ochiq). */
  enabled: boolean
  onChanged: (count: DealerCountOut) => void
  /**
   * Sahifadagi o'zgartirishlar hisoblagichi: tekshiruv davomida foydalanuvchi biror narsani
   * saqlagan bo'lsa, eskiroq server javobi uning ustidan yozilmaydi.
   */
  mutationSeq?: { current: number }
}

/**
 * Sanovni fonda yangilab turadi: har `DEALER_COUNT_REFRESH_MS` da qisqa ro'yxat (qatorlarsiz)
 * so'raladi, o'zgarish bo'lsagina to'liq sanov yuklanadi — katta ro'yxat (minglab qator) har
 * safar tortilmasin. Tab ko'rinmasa so'rov yuborilmaydi; tabga qaytilganda darhol tekshiriladi.
 * Qaytaradi: oxirgi tekshiruv vaqti.
 */
export function useDealerCountAutoRefresh({ count, enabled, onChanged, mutationSeq }: Options): Date | null {
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const countRef = useRef(count)
  const enabledRef = useRef(enabled)
  const onChangedRef = useRef(onChanged)
  countRef.current = count
  enabledRef.current = enabled
  onChangedRef.current = onChanged
  const id = count?.id
  const dealerOrgId = count?.dealer_org_id

  useEffect(() => {
    if (!id || !dealerOrgId) return
    let stopped = false
    let running = false
    const tick = async () => {
      if (running || stopped || !enabledRef.current || document.visibilityState !== 'visible') return
      running = true
      const seq = mutationSeq?.current ?? 0
      try {
        const r = await listDealerCounts({ dealer_org_id: dealerOrgId, limit: 50 })
        const summary = r.items.find((c) => c.id === id)
        const cur = countRef.current
        if (summary && cur && changed(summary, cur)) {
          const full = await getDealerCount(id)
          if (!stopped && enabledRef.current && (mutationSeq?.current ?? 0) === seq) onChangedRef.current(full)
        }
        if (!stopped) setCheckedAt(new Date())
      } catch {
        // tarmoq xatosi — keyingi safar yana urinadi
      } finally {
        running = false
      }
    }
    const timer = window.setInterval(() => void tick(), DEALER_COUNT_REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [id, dealerOrgId, mutationSeq])

  return checkedAt
}
