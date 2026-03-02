/**
 * ExpiryDatePicker locale labels (ru / uz / en).
 */
export type ExpiryPickerLocale = 'ru' | 'uz' | 'en';

export const expiryPickerLabels: Record<
  ExpiryPickerLocale,
  { year: string; month: string; day: string; cancel: string; save: string; step: (current: number, total: number) => string }
> = {
  uz: {
    year: 'Yil',
    month: 'Oy',
    day: 'Kun',
    cancel: 'Bekor qilish',
    save: 'Saqlash',
    step: (c, t) => `${c}/${t}`,
  },
  ru: {
    year: 'Год',
    month: 'Месяц',
    day: 'День',
    cancel: 'Отмена',
    save: 'Сохранить',
    step: (c, t) => `${c}/${t}`,
  },
  en: {
    year: 'Year',
    month: 'Month',
    day: 'Day',
    cancel: 'Cancel',
    save: 'Save',
    step: (c, t) => `${c}/${t}`,
  },
};

export const monthNamesShort: Record<ExpiryPickerLocale, string[]> = {
  uz: ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'],
  ru: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

export const weekdayLetters: Record<ExpiryPickerLocale, string[]> = {
  uz: ['Y', 'D', 'S', 'Ch', 'P', 'J', 'Sh'],
  ru: ['В', 'П', 'В', 'С', 'Ч', 'П', 'С'],
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
};
