import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { getProducts, type Product } from '../services/productsApi'

const DEBOUNCE_MS = 350
const SEARCH_LIMIT = 20

const cache = new Map<string, Product[]>()

export function formatProductLabel(product: Product): string {
  return `${product.sku} — ${product.name}`
}

export type ProductSearchComboboxProps = {
  value: string
  placeholder?: string
  disabled?: boolean
  onSelect: (product: Product | null) => void
  className?: string
  /** Override product label for display when selected (if known) */
  displayLabel?: string
}

export function ProductSearchCombobox({
  value,
  placeholder,
  disabled = false,
  onSelect,
  className = '',
  displayLabel,
}: ProductSearchComboboxProps) {
  const { t } = useTranslation(['receiving', 'common'])
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const search = useCallback(async (term: string) => {
    if (!term) {
      setResults([])
      return
    }
    const cached = cache.get(term.toLowerCase())
    if (cached) {
      setResults(cached)
      return
    }
    setIsSearching(true)
    try {
      const res = await getProducts({
        search: term,
        limit: SEARCH_LIMIT,
        offset: 0,
      })
      const items = res.items
      cache.set(term.toLowerCase(), items)
      setResults(items)
    } catch {
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  useEffect(() => {
    if (debouncedQuery) {
      void search(debouncedQuery)
    } else {
      setResults([])
    }
    setHighlightIndex(-1)
  }, [debouncedQuery, search])

  const handleFocus = useCallback(() => {
    setIsOpen(true)
    if (query) void search(query)
    setHighlightIndex(-1)
  }, [query, search])

  const handleBlur = useCallback(() => {
    setTimeout(() => setIsOpen(false), 150)
  }, [])

  const handleSelect = useCallback(
    (product: Product) => {
      onSelect(product)
      setQuery('')
      setResults([])
      setIsOpen(false)
      setHighlightIndex(-1)
    },
    [onSelect]
  )

  const handleClear = useCallback(() => {
    onSelect(null)
    setQuery('')
    setResults([])
    setIsOpen(false)
    setHighlightIndex(-1)
  }, [onSelect])

  const showDropdown = isOpen && (query.length > 0 || results.length > 0)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showDropdown) {
        if (e.key === 'Escape') {
          if (value) handleClear()
          else setQuery('')
          setIsOpen(false)
        }
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightIndex((i) => (i < results.length - 1 ? i + 1 : i))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIndex((i) => (i > 0 ? i - 1 : -1))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (highlightIndex >= 0 && results[highlightIndex]) {
          handleSelect(results[highlightIndex])
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (value) handleClear()
        else setQuery('')
        setIsOpen(false)
      }
    },
    [showDropdown, results, highlightIndex, value, handleSelect, handleClear]
  )

  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIndex] as HTMLElement
      el?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const inputValue = value ? (displayLabel ?? '') : query

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value
      if (value && v !== (displayLabel ?? '')) {
        onSelect(null)
        const newPart =
          displayLabel && v.startsWith(displayLabel) ? v.slice(displayLabel.length) : v
        setQuery(newPart)
      } else {
        setQuery(v)
        if (!v) onSelect(null)
      }
      if (!isOpen) setIsOpen(true)
    },
    [value, displayLabel, onSelect, isOpen]
  )

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex items-center rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <input
          type="text"
          className="w-full rounded-2xl border-0 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none dark:text-slate-100"
          placeholder={placeholder ?? t('receiving:fields.select_product')}
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => (value ? handleClear() : setIsOpen((o) => !o))}
          className="flex shrink-0 items-center justify-center px-2 py-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          aria-label={value ? t('common:buttons.close') : 'Toggle'}
        >
          <ChevronDown
            size={18}
            className={`transition-transform ${showDropdown ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      {showDropdown && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-2xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
        >
          {isSearching ? (
            <li className="px-3 py-4 text-center text-sm text-slate-500">
              {t('common:messages.loading')}
            </li>
          ) : results.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-slate-500">
              {t('receiving:no_results')}
            </li>
          ) : (
            results.map((product, idx) => (
              <li key={product.id}>
                <button
                  type="button"
                  className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                    idx === highlightIndex
                      ? 'bg-slate-100 dark:bg-slate-800'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSelect(product)
                  }}
                >
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {product.sku}
                  </span>
                  <span className="text-slate-600 dark:text-slate-300">
                    {' — '}
                    {product.name}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
