import { isTauri } from '@tauri-apps/api/core'

/**
 * `@tauri-apps/api/core` dagi `isTauri()` faqat `globalThis.isTauri` ni tekshiradi.
 * Tauri 2 WebViewda ko'pincha `window.__TAURI_INTERNALS__` bo'ladi, `isTauri` esa yo'q bo'lishi mumkin.
 */
function inTauriWebview(): boolean {
  if (typeof window === 'undefined') return false
  return (
    isTauri() ||
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window
  )
}

/**
 * Tauri WebView: global `fetch` is subject to CORS. The HTTP plugin uses Rust/reqwest
 * and bypasses CORS. Use this for all API calls so desktop login and API work reliably.
 */
export async function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (inTauriWebview()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    return tauriFetch(url, init)
  }
  return fetch(input, init)
}
