import { useTranslation } from 'react-i18next'

export function OfflineQueuePage() {
  const { t } = useTranslation('common')
  return <div>{t('labels.offline_queue')}</div>
}
