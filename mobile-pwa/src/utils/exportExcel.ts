import * as XLSX from 'xlsx'

declare global {
  interface Window {
    __TAURI__?: unknown
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Write workbook to file. In Tauri: save to Downloads and return path for "Open file".
 * In browser: trigger download and return null.
 */
export async function writeExcelFile(
  wb: XLSX.WorkBook,
  fileName: string
): Promise<string | null> {
  if (typeof window !== 'undefined' && window.__TAURI__) {
    try {
      const { downloadDir } = await import('@tauri-apps/api/path')
      const { invoke } = await import('@tauri-apps/api/core')
      const dir = await downloadDir()
      const fullPath = dir ? `${dir.replace(/\/$/, '')}/${fileName}` : null
      if (!fullPath) return null
      const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      const contentsBase64 = arrayBufferToBase64(arrayBuffer)
      await invoke('write_excel_file', { path: fullPath, contentsBase64 })
      return fullPath
    } catch {
      // fallback to browser download
    }
  }
  XLSX.writeFile(wb, fileName)
  return null
}
