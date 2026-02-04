import { requestJson } from '../http'
import type { StockMovementCreate } from './types'

export async function createStockMovement(payload: StockMovementCreate) {
  return requestJson('/api/v1/stock-movements/', {
    method: 'POST',
    body: payload,
  })
}
