import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { listDocuments } from '../../services/api/documents'
import type { DocumentListItem, DocumentStatus, DocumentType } from '../../services/api/types'
import type { ApiError } from '../../services/api/client'

function formatError(error: unknown) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return (error as ApiError).message
  }
  return 'Serverga ulanishda xato yuz berdi. Internetni tekshiring.'
}

const BASE_PATH = '/picking/mobile-pwa'
const STATUS_OPTIONS: Array<{ value: DocumentStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'in_progress', label: 'In progress' },
]

export function PickListPage() {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | ''>('')
  const [docTypeFilter, setDocTypeFilter] = useState<DocumentType | ''>('')

  const filters = useMemo(
    () => ({
      status: statusFilter || undefined,
      doc_type: docTypeFilter || undefined,
    }),
    [statusFilter, docTypeFilter]
  )

  const loadDocuments = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const data = await listDocuments(filters)
      setDocuments(data)
    } catch (error) {
      setErrorMessage(`Pick list yuklanmadi. ${formatError(error)}`)
    } finally {
      setIsLoading(false)
    }
  }, [filters])

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
        <label>
          Status:
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as DocumentStatus | '')
            }
          >
            <option value="">Barchasi</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Doc type:
          <select
            value={docTypeFilter}
            onChange={(event) =>
              setDocTypeFilter(event.target.value as DocumentType | '')
            }
          >
            <option value="">Barchasi</option>
            <option value="SO">SO</option>
          </select>
        </label>
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
                  <strong>{doc.reference_number}</strong>
                </div>
                <div>Status: {doc.status}</div>
                <div>
                  Progress: {doc.lines_done}/{doc.lines_total} lines
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
