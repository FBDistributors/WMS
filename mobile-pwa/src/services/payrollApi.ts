import { fetchJSON } from './apiClient'

/** Bitta buyurtma uchun to'lov: rol (`picker`/`controller`) + manba guruhi. */
export type PayrollRate = {
  role: string
  source_group: string
  amount: number
}

export async function getPayrollRates(): Promise<PayrollRate[]> {
  const data = await fetchJSON<{ rates: PayrollRate[] }>('/api/v1/payroll-rates')
  return data.rates
}

export async function savePayrollRates(rates: PayrollRate[]): Promise<PayrollRate[]> {
  const data = await fetchJSON<{ rates: PayrollRate[] }>('/api/v1/payroll-rates', {
    method: 'PUT',
    body: { rates },
  })
  return data.rates
}
