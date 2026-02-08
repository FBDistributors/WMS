import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

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
      setErrorMessage(`Pick list yuklanmadi. ${formatError(error)}`)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDocuments()
  }, [loadDocuments])

  if (isLoading) {
    return <div>Yuklanmoqda...</div>
  }

  if (errorMessage) {
    return (
      <div>
        <p>{errorMessage}</p>
        <button type="button" onClick={loadDocuments}>
          Qayta urinib ko‘rish
        </button>
      </div>
    )
  }

  return (
    <div>
      <h1>Pick List</h1>
      <div>
        <button type="button" onClick={loadDocuments}>
          Yangilash
        </button>
      </div>
      {documents.length === 0 ? (
        <div>Hujjatlar topilmadi.</div>
      ) : (
        <ul>
          {documents.map((doc) => (
            <li key={doc.id}>
              <Link to={`${BASE_PATH}/${doc.id}`}>
                <div>
                  <strong>{doc.document_no}</strong>
                </div>
                <div>
                  Progress: {doc.picked_lines}/{doc.total_lines} lines
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
