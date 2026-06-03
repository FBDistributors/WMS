import { useCallback } from 'react'

import type { ReceiptExportContext } from '../../../utils/receiptExport'
import {
  downloadReceiptCsv,
  downloadReceiptExcel,
  downloadReceiptPdf,
} from '../../../utils/receiptExport'
import { ExportFormatDropdown, type ExportFormat } from './ExportFormatDropdown'

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
  const runExport = useCallback(
    async (kind: ExportFormat) => {
      try {
        if (kind === 'excel') {
          await downloadReceiptExcel(ctx)
        } else if (kind === 'csv') {
          downloadReceiptCsv(ctx)
        } else {
          await downloadReceiptPdf(ctx)
        }
        onSuccess?.()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        onError?.(msg)
        throw err
      }
    },
    [ctx, onError, onSuccess]
  )

  return (
    <ExportFormatDropdown
      disabled={disabled}
      onExport={async (kind) => {
        try {
          await runExport(kind)
        } catch {
          /* onError already called */
        }
      }}
    />
  )
}
