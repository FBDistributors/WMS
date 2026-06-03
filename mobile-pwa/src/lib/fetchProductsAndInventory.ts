import { getInventorySummary } from '../services/inventoryApi'
import { getProducts, type Product } from '../services/productsApi'

const ID_CHUNK_SIZE = 150

async function fetchProductsChunked(productIds: string[]): Promise<Product[]> {
  if (productIds.length === 0) return []
  const items: Product[] = []
  for (let i = 0; i < productIds.length; i += ID_CHUNK_SIZE) {
    const chunk = productIds.slice(i, i + ID_CHUNK_SIZE)
    const res = await getProducts({ product_ids: chunk, limit: chunk.length })
    items.push(...res.items)
  }
  return items
}

async function fetchInventoryChunked(productIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (productIds.length === 0) return map
  for (let i = 0; i < productIds.length; i += ID_CHUNK_SIZE) {
    const chunk = productIds.slice(i, i + ID_CHUNK_SIZE)
    const rows = await getInventorySummary({ product_ids: chunk })
    rows.forEach((row) => {
      map.set(row.product_id, Math.round(Number(row.on_hand_total)))
    })
  }
  return map
}

export async function fetchProductsAndInventoryForExport(productIds: string[]): Promise<{
  products: Product[]
  inventoryMap: Map<string, number>
}> {
  const unique = [...new Set(productIds.filter(Boolean))]
  const [products, inventoryMap] = await Promise.all([
    fetchProductsChunked(unique),
    fetchInventoryChunked(unique),
  ])
  return { products, inventoryMap }
}
