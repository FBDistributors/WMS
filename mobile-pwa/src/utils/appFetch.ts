import { isTauri } from '@tauri-apps/api/core'

/**
 * Tauri WebView: global `fetch` is subject to CORS. The HTTP plugin uses Rust/reqwest
 * and bypasses CORS. Use this for all API calls so desktop login and API work reliably.
 *
 * `import.meta.env.TAURI_ENV_PLATFORM` ba'zi production bundle'larda yo'q bo'lishi mumkin;
 * `isTauri()` runtime'da aniq ishlaydi.
 */
export async function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
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
