import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Location } from '../services/locationsApi'

export function formatLocationLabel(loc: Location): string {
  if (loc.code === loc.name || !loc.name) return loc.code
  return `${loc.code} · ${loc.name}`
}

export type LocationSearchComboboxProps = {
  locations: Location[]
  value: string
  placeholder?: string
  disabled?: boolean
  onSelect: (location: Location | null) => void
  className?: string
  displayLabel?: string
}

const MAX_LIST_HEIGHT = 280

export function LocationSearchCombobox({
  locations,
  value,
  placeholder,
  disabled = false,
  onSelect,
  className = '',
  displayLabel,
}: LocationSearchComboboxProps) {
  const { t } = useTranslation(['receiving', 'common'])
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return locations
    return locations.filter(
      (loc) =>
        loc.code.toLowerCase().includes(q) ||
        (loc.name && loc.name.toLowerCase().includes(q)) ||
        (loc.sector && loc.sector.toLowerCase().includes(q))
    )
  }, [locations, query])

  const displayList = query.trim() ? filtered : locations
  const showDropdown = isOpen

  const handleFocus = useCallback(() => {
    setIsOpen(true)
    setHighlightIndex(-1)
  }, [])

  const handleBlur = useCallback(() => {
    setTimeout(() => setIsOpen(false), 150)
  }, [])

  const handleSelect = useCallback(
    (loc: Location) => {
      onSelect(loc)
      setQuery('')
      setIsOpen(false)
      setHighlightIndex(-1)
    },
    [onSelect]
  )

  const handleClear = useCallback(() => {
    onSelect(null)
    setQuery('')
    setIsOpen(false)
    setHighlightIndex(-1)
  }, [onSelect])

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
        setHighlightIndex((i) => (i < displayList.length - 1 ? i + 1 : i))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIndex((i) => (i > 0 ? i - 1 : -1))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (highlightIndex >= 0 && displayList[highlightIndex]) {
          handleSelect(displayList[highlightIndex])
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
    [showDropdown, displayList, highlightIndex, value, handleSelect, handleClear]
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
      setHighlightIndex(0)
    },
    [value, displayLabel, onSelect, isOpen]
  )

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex items-center rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <input
          type="text"
          className="w-full rounded-2xl border-0 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none dark:text-slate-100"
          placeholder={placeholder ?? t('receiving:fields.select_location')}
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
          className="absolute z-50 mt-1 w-full overflow-auto rounded-2xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
          style={{ maxHeight: MAX_LIST_HEIGHT }}
        >
          {query.trim() && displayList.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-slate-500">
              {t('receiving:no_results')}
            </li>
          ) : (
            displayList.map((loc, idx) => (
              <li key={loc.id}>
                <button
                  type="button"
                  className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition-colors ${
                    idx === highlightIndex
                      ? 'bg-blue-50 dark:bg-blue-950/40'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSelect(loc)
                  }}
                >
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {loc.code}
                  </span>
                  {loc.name && loc.name !== loc.code && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {loc.name}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
