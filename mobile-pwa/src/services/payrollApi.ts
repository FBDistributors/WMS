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
  /** Yirik buyurtma chegarasi: ro'yxatdagi mijoz (UZUM) buyurtmasi shu summadan
   * ORTIQ bo'lsa — region tarifida to'lanadi. */
  big_order_threshold: number
}

export async function getPayrollRates(): Promise<PayrollRatesResponse> {
  return fetchJSON<PayrollRatesResponse>('/api/v1/payroll-rates')
}

export async function savePayrollRates(
  rates: PayrollRate[],
  bigOrderThreshold?: number,
): Promise<PayrollRatesResponse> {
  return fetchJSON<PayrollRatesResponse>('/api/v1/payroll-rates', {
    method: 'PUT',
    body: {
      rates,
      ...(bigOrderThreshold != null ? { big_order_threshold: bigOrderThreshold } : {}),
    },
  })
}
