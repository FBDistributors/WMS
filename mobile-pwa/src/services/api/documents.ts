import { fetchJSON } from './client'
import type { DocumentDetails, DocumentListItem, DocumentStatus, DocumentType } from './types'

type ListDocumentsParams = {
  status?: DocumentStatus
  doc_type?: DocumentType
  limit?: number
  offset?: number
}

export async function listDocuments(params: ListDocumentsParams = {}) {
  const {
    doc_type,
    status,
    limit = 50,
    offset = 0,
  } = params

  const searchParams = new URLSearchParams()
  if (doc_type) {
    searchParams.set('doc_type', doc_type)
  }
  if (status) {
    searchParams.set('status', status)
  }
  searchParams.set('limit', String(limit))
  searchParams.set('offset', String(offset))

  return fetchJSON<DocumentListItem[]>(
    `/api/v1/documents?${searchParams.toString()}`
  )
}

export async function getDocument(id: string) {
  return fetchJSON<DocumentDetails>(`/api/v1/documents/${id}`)
}
