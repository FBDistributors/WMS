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
export function getFilialNameByCode(code: string | null | undefined): string {
  if (code == null || String(code).trim() === '') return '—'
  const normalized = String(code).trim().padStart(3, '0')
  return FILIAL_CODE_TO_NAME[normalized] ?? code
}
