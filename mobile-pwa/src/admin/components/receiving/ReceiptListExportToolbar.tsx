import { ExportFormatDropdown, type ExportFormat } from './ExportFormatDropdown'

type ReceiptListExportToolbarProps = {
  disabled?: boolean
  onExport: (kind: ExportFormat) => Promise<void>
}

export function ReceiptListExportToolbar({
  disabled = false,
  onExport,
}: ReceiptListExportToolbarProps) {
  return <ExportFormatDropdown disabled={disabled} onExport={onExport} />
}
