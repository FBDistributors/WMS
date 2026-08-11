import { fetchJSON } from './apiClient'

/** Bitta buyurtma uchun to'lov: rol (`picker`/`controller`) + manba guruhi. */
export type PayrollRate = {
  role: string
  source_group: string
  amount: number
}

export type PayrollRatesResponse = {
  rates: PayrollRate[]
  /** Tahrir shu davrdan boshlab kuchga kiradi; oldingi davrlar tegilmaydi. */
  effective_from: string
}

export async function getPayrollRates(): Promise<PayrollRatesResponse> {
  return fetchJSON<PayrollRatesResponse>('/api/v1/payroll-rates')
}

export async function savePayrollRates(rates: PayrollRate[]): Promise<PayrollRatesResponse> {
  return fetchJSON<PayrollRatesResponse>('/api/v1/payroll-rates', {
    method: 'PUT',
    body: { rates },
  })
}
