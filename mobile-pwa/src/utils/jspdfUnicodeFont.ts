import type { jsPDF } from 'jspdf'

const NOTO_SANS_REGULAR_URL =
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf'

const VFS_FILE = 'NotoSans-Regular.ttf'
const FONT_FAMILY = 'NotoSans'

let cachedBase64: string | null = null
let loadPromise: Promise<string> | null = null

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function loadNotoSansBase64(): Promise<string> {
  if (cachedBase64) {
    return cachedBase64
  }
  if (!loadPromise) {
    loadPromise = fetch(NOTO_SANS_REGULAR_URL)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Font load failed: ${res.status}`)
        }
        return res.arrayBuffer()
      })
      .then(arrayBufferToBase64)
      .then((b64) => {
        cachedBase64 = b64
        return b64
      })
  }
  return loadPromise
}

/** Cyrillic/Latin matn uchun Noto Sans (jsPDF default Helvetica Unicode qo‘llamaydi). */
export async function applyUnicodeFontToPdf(doc: jsPDF): Promise<string> {
  const base64 = await loadNotoSansBase64()
  doc.addFileToVFS(VFS_FILE, base64)
  doc.addFont(VFS_FILE, FONT_FAMILY, 'normal')
  doc.setFont(FONT_FAMILY, 'normal')
  return FONT_FAMILY
}

export const PDF_UNICODE_FONT_FAMILY = FONT_FAMILY
