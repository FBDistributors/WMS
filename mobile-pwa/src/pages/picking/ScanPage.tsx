import { useTranslation } from 'react-i18next'

export function ScanPage() {
  const { t } = useTranslation('picking')
  return <div>{t('scan_title')}</div>
}
