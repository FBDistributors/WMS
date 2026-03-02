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

  return fetchJSON<DocumentListItem[]>('/api/v1/documents', {
    query: {
      doc_type,
      status,
      limit,
      offset,
    },
  })
}

export async function getDocument(id: string) {
  return fetchJSON<DocumentDetails>(`/api/v1/documents/${id}`)
}
