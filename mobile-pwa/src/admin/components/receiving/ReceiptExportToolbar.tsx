import { useCallback, useState } from 'react'
import { FileSpreadsheet, FileText, FileType2, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import type { ReceiptExportContext } from '../../../utils/receiptExport'
import {
  downloadReceiptCsv,
  downloadReceiptExcel,
  downloadReceiptPdf,
} from '../../../utils/receiptExport'

type ReceiptExportToolbarProps = {
  ctx: ReceiptExportContext
  disabled?: boolean
  onSuccess?: () => void
  onError?: (message: string) => void
}

export function ReceiptExportToolbar({
  ctx,
  disabled = false,
  onSuccess,
  onError,
}: ReceiptExportToolbarProps) {
  const { t } = useTranslation(['receiving'])
  const [isExporting, setIsExporting] = useState(false)

  const runExport = useCallback(
    async (kind: 'excel' | 'csv' | 'pdf') => {
      if (disabled || isExporting) return
      setIsExporting(true)
      try {
        if (kind === 'excel') {
          await downloadReceiptExcel(ctx)
        } else if (kind === 'csv') {
          downloadReceiptCsv(ctx)
        } else {
          downloadReceiptPdf(ctx)
        }
        onSuccess?.()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        onError?.(msg)
      } finally {
        setIsExporting(false)
      }
    },
    [ctx, disabled, isExporting, onError, onSuccess]
  )

  const busy = disabled || isExporting

  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <Button
        variant="secondary"
        className="h-10 w-10 rounded-xl p-0"
        onClick={() => void runExport('excel')}
        disabled={busy}
        title={t('receiving:export_excel')}
        aria-label={t('receiving:export_excel')}
      >
        {isExporting ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <FileSpreadsheet size={18} />
        )}
      </Button>
      <Button
        variant="secondary"
        className="h-10 w-10 rounded-xl p-0"
        onClick={() => void runExport('csv')}
        disabled={busy}
        title={t('receiving:export_csv')}
        aria-label={t('receiving:export_csv')}
      >
        <FileType2 size={18} />
      </Button>
      <Button
        variant="secondary"
        className="h-10 w-10 rounded-xl p-0"
        onClick={() => void runExport('pdf')}
        disabled={busy}
        title={t('receiving:export_pdf')}
        aria-label={t('receiving:export_pdf')}
      >
        <FileText size={18} />
      </Button>
    </div>
  )
}
