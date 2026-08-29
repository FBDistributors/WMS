import { fetchJSON } from './apiClient'

export type SaleExpiryCutoff = {
  /** ISO sana yoki null — qoida o'chiq. */
  cutoff: string | null
}

/** Sotuv muddat chegarasi: muddati shu sanadan OLDIN tugaydigan lotlar oddiy
 * sotuvga chiqmaydi (ajratish tanlamaydi, muqobil joy taklif qilinmaydi). */
export async function getSaleExpiryCutoff(): Promise<SaleExpiryCutoff> {
  return fetchJSON<SaleExpiryCutoff>('/api/v1/app-settings/sale-expiry-cutoff')
}

export async function saveSaleExpiryCutoff(cutoff: string | null): Promise<SaleExpiryCutoff> {
  return fetchJSON<SaleExpiryCutoff>('/api/v1/app-settings/sale-expiry-cutoff', {
    method: 'PUT',
    body: { cutoff },
  })
}
