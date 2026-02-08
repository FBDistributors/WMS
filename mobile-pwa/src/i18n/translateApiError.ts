import i18n from './index'

export function translateApiError(code?: string) {
  if (!code) return i18n.t('errors.unknown')
  return i18n.t(`errors.${code}`, { defaultValue: i18n.t('errors.unknown') })
}
