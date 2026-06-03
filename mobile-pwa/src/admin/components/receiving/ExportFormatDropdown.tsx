import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  FileType2,
  Loader2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'

export type ExportFormat = 'excel' | 'csv' | 'pdf'

type ExportFormatDropdownProps = {
  disabled?: boolean
  onExport: (kind: ExportFormat) => Promise<void>
}

export function ExportFormatDropdown({
  disabled = false,
  onExport,
}: ExportFormatDropdownProps) {
  const { t } = useTranslation(['receiving'])
  const [isExporting, setIsExporting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  const runExport = async (kind: ExportFormat) => {
    if (disabled || isExporting) return
    setMenuOpen(false)
    setIsExporting(true)
    try {
      await onExport(kind)
    } finally {
      setIsExporting(false)
    }
  }

  const busy = disabled || isExporting

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <Button
        variant="secondary"
        className="h-10 gap-1.5 rounded-xl px-3"
        onClick={() => setMenuOpen((o) => !o)}
        disabled={busy}
        title={t('receiving:export_download')}
        aria-label={t('receiving:export_download')}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        {isExporting ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Download size={18} />
        )}
        <ChevronDown size={16} className="opacity-70" />
      </Button>
      {menuOpen && !busy ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[11rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => void runExport('excel')}
          >
            <FileSpreadsheet size={16} />
            {t('receiving:export_excel')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => void runExport('csv')}
          >
            <FileType2 size={16} />
            {t('receiving:export_csv')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => void runExport('pdf')}
          >
            <FileText size={16} />
            {t('receiving:export_pdf')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
