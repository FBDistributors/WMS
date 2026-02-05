import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  completePickingDocument,
  getPickingDocument,
  pickLine,
  type ApiError,
  type PickingDocument,
  type PickingLine,
} from '../../api/picking'

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

export function DocumentDetailsPage() {
  const { documentId } = useParams()
  const navigate = useNavigate()
  const [document, setDocument] = useState<PickingDocument | null>(null)
  const [lines, setLines] = useState<PickingLine[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCompleting, setIsCompleting] = useState(false)
  const [barcodeValue, setBarcodeValue] = useState('')
  const barcodeInputRef = useRef<HTMLInputElement | null>(null)

  const loadDocument = useCallback(async () => {
    if (!documentId) {
      setErrorMessage('Hujjat ID topilmadi.')
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const data = await getPickingDocument(documentId)
      setDocument(data)
    } catch (error) {
      setErrorMessage(`Hujjat yuklanmadi. ${formatError(error)}`)
    } finally {
      setIsLoading(false)
    }
  }, [documentId])

  useEffect(() => {
    void loadDocument()
  }, [loadDocument])

  useEffect(() => {
    if (document) {
      setLines(document.lines)
    }
  }, [document])

  useEffect(() => {
    barcodeInputRef.current?.focus()
  }, [isLoading, document])

  if (isLoading) {
    return <div>Yuklanmoqda...</div>
  }

  if (errorMessage) {
    return (
      <div>
        <p>{errorMessage}</p>
        <button type="button" onClick={loadDocument}>
          Qayta urinib ko‘rish
        </button>
        <div>
          <Link to={BASE_PATH}>Orqaga</Link>
        </div>
      </div>
    )
  }

  if (!document) {
    return <div>Hujjat topilmadi.</div>
  }

  const progress = useMemo(() => {
    const required = lines.reduce((sum, line) => sum + line.qty_required, 0)
    const picked = lines.reduce((sum, line) => sum + line.qty_picked, 0)
    const linesTotal = lines.length
    const linesDone = lines.filter(
      (line) => line.qty_picked >= line.qty_required
    ).length
    return { required, picked, linesTotal, linesDone }
  }, [lines])

  const updatePicked = useCallback((lineId: string, delta: 1 | -1) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line
        const nextQty = Math.max(
          0,
          Math.min(line.qty_picked + delta, line.qty_required)
        )
        return { ...line, qty_picked: nextQty }
      })
    )
  }, [])

  const handlePick = useCallback(
    async (lineId: string, delta: 1 | -1) => {
      const target = lines.find((line) => line.id === lineId)
      if (!target) {
        return
      }
      if (delta === 1 && target.qty_picked >= target.qty_required) {
        setErrorMessage('Qty required dan oshib ketdi.')
        return
      }
      if (delta === -1 && target.qty_picked <= 0) {
        setErrorMessage('Qty 0 dan past bo‘lolmaydi.')
        return
      }
      const previous = lines
      updatePicked(lineId, delta)
      try {
        // Optimistic update with rollback on API error.
        const requestId =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`
        const response = await pickLine(lineId, delta, requestId)
        setLines((prev) =>
          prev.map((line) => (line.id === lineId ? response.line : line))
        )
        if (response.document_status) {
          setDocument((current) =>
            current ? { ...current, status: response.document_status } : current
          )
        }
      } catch (error) {
        setLines(previous)
        setErrorMessage(`Picking muvaffaqiyatsiz. ${formatError(error)}`)
      }
    },
    [lines, updatePicked]
  )

  const handleBarcodeSubmit = useCallback(() => {
    const value = barcodeValue.trim()
    if (!value) return
    const matched = lines.find(
      (line) => line.barcode === value || line.sku === value
    )
    if (!matched) {
      alert('Topilmadi')
      setBarcodeValue('')
      return
    }
    void handlePick(matched.id, 1)
    setBarcodeValue('')
  }, [barcodeValue, handlePick, lines])

  const handleComplete = useCallback(async () => {
    if (!documentId) return
    setIsCompleting(true)
    setErrorMessage(null)
    try {
      await completePickingDocument(documentId)
      navigate(BASE_PATH)
    } catch (error) {
      setErrorMessage(`Yakunlashda xato. ${formatError(error)}`)
    } finally {
      setIsCompleting(false)
    }
  }, [documentId, navigate])

  return (
    <div style={{ padding: '16px' }}>
      <Link to={BASE_PATH}>← Pick list</Link>
      <h1 style={{ marginTop: '12px' }}>{document.reference_number}</h1>
      <div>Status: {document.status}</div>
      <div style={{ marginTop: '8px' }}>
        Progress: {progress.picked}/{progress.required} qty
      </div>
      <div style={{ marginTop: '4px' }}>
        Lines: {progress.linesDone}/{progress.linesTotal}
      </div>
      <div style={{ marginTop: '12px' }}>
        <label style={{ display: 'block', marginBottom: '6px' }}>
          Barcode (scan):
        </label>
        <input
          ref={barcodeInputRef}
          type="text"
          value={barcodeValue}
          onChange={(event) => setBarcodeValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleBarcodeSubmit()
            }
          }}
          onBlur={() => barcodeInputRef.current?.focus()}
          placeholder="Barcode skan qiling"
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '16px',
            borderRadius: '10px',
            border: '1px solid #ccc',
          }}
        />
      </div>
      {errorMessage ? (
        <div style={{ marginTop: '10px', color: '#c62828' }}>
          {errorMessage}
        </div>
      ) : null}
      <h2>Lines</h2>
      <ul>
        {lines.map((line) => {
          const remaining = line.qty_required - line.qty_picked
          const isDone = line.qty_picked >= line.qty_required
          return (
            <li
              key={line.id}
              style={{
                padding: '12px',
                marginBottom: '12px',
                borderRadius: '12px',
                border: '1px solid #e0e0e0',
                background: isDone ? '#e8f5e9' : '#fff',
              }}
            >
              <div>
                <strong>{line.product_name}</strong>
              </div>
              <div>Location: {line.location_code}</div>
              <div>Barcode: {line.barcode ?? '—'}</div>
              <div>Required: {line.qty_required}</div>
              <div>Picked: {line.qty_picked}</div>
              <div>Remaining: {remaining}</div>
              <div style={{ marginTop: '8px', fontWeight: 600 }}>
                Progress: {line.qty_picked}/{line.qty_required}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  marginTop: '12px',
                }}
              >
                <button
                  type="button"
                  onClick={() => handlePick(line.id, -1)}
                  style={{
                    flex: 1,
                    padding: '14px',
                    fontSize: '16px',
                    borderRadius: '12px',
                  }}
                >
                  -1
                </button>
                <button
                  type="button"
                  onClick={() => handlePick(line.id, 1)}
                  style={{
                    flex: 1,
                    padding: '14px',
                    fontSize: '16px',
                    borderRadius: '12px',
                  }}
                >
                  +1
                </button>
              </div>
              {isDone ? (
                <div style={{ marginTop: '8px', color: '#2e7d32' }}>
                  Done
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={handleComplete}
        disabled={isCompleting}
        style={{
          width: '100%',
          padding: '16px',
          fontSize: '18px',
          borderRadius: '14px',
          background: '#1976d2',
          color: '#fff',
          border: 'none',
        }}
      >
        {isCompleting ? 'Yakunlanmoqda...' : 'Done / Complete'}
      </button>
    </div>
  )
}
