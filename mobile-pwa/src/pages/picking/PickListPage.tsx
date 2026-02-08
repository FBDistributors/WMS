import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { listPickLists, type PickList } from '../../services/pickingApi'
import type { ApiError } from '../../services/apiClient'

function formatError(error: unknown) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const apiError = error as ApiError
    const details = apiError.details
    if (typeof details === 'string') {
      return details
    }
    if (details && typeof details === 'object') {
      if ('detail' in details && typeof details.detail === 'string') {
        return details.detail
      }
      if ('message' in details && typeof details.message === 'string') {
        return details.message
      }
    }
    return apiError.message
  }
  return 'Serverga ulanishda xato yuz berdi. Internetni tekshiring.'
}

const BASE_PATH = '/picking/mobile-pwa'
export function PickListPage() {
  const { t } = useTranslation(['picking', 'common'])
  const [documents, setDocuments] = useState<PickList[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadDocuments = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const data = await listPickLists()
      setDocuments(data)
    } catch (error) {
      setErrorMessage(`${t('picking:load_error')} ${formatError(error)}`)
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadDocuments()
  }, [loadDocuments])

  if (isLoading) {
    return <div>{t('common:messages.loading')}</div>
  }

  if (errorMessage) {
    return (
      <div>
        <p>{errorMessage}</p>
        <button type="button" onClick={loadDocuments}>
          {t('common:buttons.retry')}
        </button>
      </div>
    )
  }

  return (
    <div>
      <h1>{t('picking:list_title')}</h1>
      <div>
        <button type="button" onClick={loadDocuments}>
          {t('picking:refresh')}
        </button>
      </div>
      {documents.length === 0 ? (
        <div>{t('picking:empty_title')}</div>
      ) : (
        <ul>
          {documents.map((doc) => (
            <li key={doc.id}>
              <Link to={`${BASE_PATH}/${doc.id}`}>
                <div>
                  <strong>{doc.document_no}</strong>
                </div>
                <div>
                  {t('picking:progress_picked', {
                    picked: doc.picked_lines,
                    total: doc.total_lines,
                  })}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
