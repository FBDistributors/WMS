/**
 * Filial ID (ИД организации) va Yuridik nom (Юридическое лицо) — SmartUP balance$export header filial_id uchun.
 * Custom qoldiq tab dropdown va "Hammasini tanlash" da ishlatiladi.
 */
export const FILIAL_LIST: { id: string; name: string }[] = [
  { id: '3788131', name: 'Головной Офис' },
  { id: '3964966', name: 'Дилер Ипподром (Иззат)' },
  { id: '8109098', name: 'Дилер Таш.область (Илхом)' },
  { id: '8109099', name: 'Дилер Урикзор (Улугбек)' },
  { id: '8109100', name: 'Дилер Янгиюль (Нодыра)' },
  { id: '8109101', name: 'Дилер Фергана (Тавакал)' },
  { id: '8109102', name: 'Дилер Андижан (Акмалжон)' },
  { id: '8109103', name: 'Дилер Наманган (Шухрат)' },
  { id: '8109104', name: 'Дилер Таш обл (Мейрлан) Проф' },
  { id: '8109105', name: 'Дилер Коканд (Камолов Сардор)' },
  { id: '8109106', name: 'Дилер Жиззах (Шердил)' },
  { id: '8109107', name: 'Дилер Самарканд (Абдужалил)' },
  { id: '8109108', name: 'Дилер Бухара (Жамшид)' },
  { id: '8109109', name: 'Дилер Нукус (Андрей) Проф' },
  { id: '8109110', name: 'Дилер Карши (Улугбек)' },
  { id: '8109111', name: 'Дилер Термез (Гайрат)' },
  { id: '8109112', name: 'Дилер Хорезм (Мансур)' },
  { id: '8109113', name: 'Дилер Нукус (Урал)' },
  { id: '8109114', name: 'Дилер Навоий (Жамшид)' },
  { id: '8109115', name: 'Дилер Андижан (Иззатулло) (старый)' },
  { id: '8109116', name: 'Дилер Жиззах (Мунаввар) Проф' },
  { id: '8109117', name: 'Дилер Самарканд (Илдар) проф' },
]

/**
 * Filial kodlari (001–021) va ularning nomlari.
 * Tashkiliy harakatlar jadvalida to_filial_code bo'yicha filial nomini ko'rsatish uchun.
 */
export const FILIAL_CODE_TO_NAME: Record<string, string> = {
  '001': 'Головной Офис',
  '002': 'Дилер Ипподром (Иззат) - NEW',
  '003': 'Дилер Таш.область (Илхом) - NEW',
  '004': 'Дилер Урикзор (Улугбек) - NEW',
  '005': 'Дилер Янгиюль (Нодыра) - NEW',
  '006': 'Дилер Фергана (Тавакал) - NEW',
  '007': 'Дилер Андижан (Акмалжон) - NEW',
  '008': 'Дилер Наманган (Шухрат) - NEW',
  '009': 'Дилер Таш обл (Мейрлан) Проф',
  '010': 'Дилер Коканд (Камолов Сардор) - NEW',
  '011': 'Дилер Жиззах (Шердил) - NEW',
  '012': 'Дилер Самарканд (Абдужалил) - NEW',
  '013': 'Дилер Бухара (Жамшид) - NEW',
  '014': 'Дилер Карши (Улугбек) - NEW',
  '015': 'Дилер Термез (Гайрат) - NEW',
  '016': 'Дилер Хорезм (Мансур) - NEW',
  '017': 'Дилер Нукус (Урал) - NEW',
  '018': 'Дилер Навои (Жамшид) - NEW',
  '019': 'Дилер Андижан (Иззатулло) (старый)',
  '020': 'Дилер Жиззах (Мунаввар) Проф',
  '021': 'Дилер Самарканд (Илдар) проф',
}

/**
 * Filial kodi bo'yicha nom qaytaradi.
 * Kod 3 xonali formatda bo'lmasa (masalan "21") avval normalize qilinadi.
 * Topilmasa: kod bo'sh emas bo'lsa o'zi, aks holda "—".
 */
const FILIAL_ID_TO_NAME = Object.fromEntries(FILIAL_LIST.map((f) => [f.id, f.name]))

export function getFilialNameById(id: string | null | undefined): string | null {
  if (id == null || String(id).trim() === '') return null
  return FILIAL_ID_TO_NAME[String(id).trim()] ?? null
}

/** SmartUP izoh: «Заказ Дилер Таш обл…» → filial nomi (flat eksportda to_filial_code bo'lmasa). */
export function resolveFilialNameFromNote(note: string | null | undefined): string | null {
  const text = (note ?? '').trim().toLowerCase()
  if (!text || !text.includes('дилер')) return null
  let best: { name: string; score: number } | null = null
  for (const { id, name } of FILIAL_LIST) {
    if (id === '3788131') continue
    const m = name.toLowerCase().match(/дилер\s+([^()]+)/i)
    const keyword = (m?.[1] ?? name).trim().replace(/\s+/g, ' ')
    if (keyword.length < 4) continue
    if (text.includes(keyword)) {
      const score = keyword.length
      if (!best || score > best.score) best = { name, score }
    }
  }
  return best?.name ?? null
}

export function getFilialNameByCode(code: string | null | undefined): string {
  if (code == null || String(code).trim() === '') return '—'
  const raw = String(code).trim()
  const normalized = raw.padStart(3, '0')
  return FILIAL_CODE_TO_NAME[normalized] ?? FILIAL_CODE_TO_NAME[raw] ?? raw
}

/**
 * SmartUp filial_id (3788131) yoki filial kodi (001–021) → yuridik nom.
 */
export function resolveFilialLabel(codeOrId: string | null | undefined): string {
  if (codeOrId == null || String(codeOrId).trim() === '') return '—'
  const v = String(codeOrId).trim()
  const byId = getFilialNameById(v)
  if (byId) return byId
  const byCode = getFilialNameByCode(v)
  return byCode !== '—' ? byCode : v
}

/** Ombor kodi (001) — organizatsiya ID emas */
function isWarehouseFilialCode(code: string): boolean {
  return /^\d{1,3}$/.test(code)
}

/**
 * Tashkiliy harakat jadvali: SmartUP to_filial_code → Organizatsiya sozlamalari nomi.
 * from_warehouse_code (001) ko'rsatilmaydi.
 */
export function formatDillerFilialDisplay(order: {
  filial_display_name?: string | null
  to_filial_code?: string | null
  filial_id?: string | null
  from_warehouse_code?: string | null
  movement_note?: string | null
}): string {
  const named = order.filial_display_name?.trim()
  if (named) return named
  const fromNote = resolveFilialNameFromNote(order.movement_note)
  if (fromNote) return fromNote
  const toFilial = order.to_filial_code?.trim()
  if (toFilial) {
    const label = getFilialNameById(toFilial)
    return label ?? toFilial
  }
  const fid = order.filial_id?.trim()
  if (fid && !isWarehouseFilialCode(fid)) {
    const label = getFilialNameById(fid)
    return label ?? fid
  }
  if (fid && isWarehouseFilialCode(fid) && fid === order.from_warehouse_code?.trim()) {
    return '—'
  }
  return '—'
}
