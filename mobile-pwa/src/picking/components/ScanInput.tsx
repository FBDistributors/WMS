import { useEffect, useRef, useState } from 'react'

type ScanInputProps = {
  onScan: (code: string) => void
  placeholder?: string
}

function normalizeScan(value: string) {
  return value.trim().replace(/\s+/g, '')
}

export function ScanInput({ onScan, placeholder = 'Scan or type barcode/SKU' }: ScanInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const normalized = normalizeScan(value)
    if (!normalized) return
    onScan(normalized)
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <input
        ref={inputRef}
        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400"
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
        inputMode="text"
      />
    </div>
  )
}
