export type DurationUnits = { h: string; m: string; s: string }

/** Soniyani inson o'qiydigan qisqa formatga: "1 soat 5 daq" / "12 daq" / "45 s". */
export function formatDuration(
  seconds: number | null | undefined,
  units: DurationUnits
): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.round(seconds)
  if (total < 60) return `${total} ${units.s}`
  const totalMin = Math.round(total / 60)
  if (totalMin < 60) return `${totalMin} ${units.m}`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h} ${units.h} ${m} ${units.m}` : `${h} ${units.h}`
}
