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
