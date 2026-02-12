import type { ReactNode } from 'react'
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

import { PickerBottomNav } from './PickerBottomNav'
import { ScanModal } from './ScanModal'
import { resolveBarcode } from '../../services/scannerApi'
import { getInventoryByBarcode } from '../../services/pickerInventoryApi'
import { getBarcodeCache, setBarcodeCache } from '../../lib/barcodeCache'

type PickerLayoutProps = {
  children: ReactNode
}

export function PickerLayout({ children }: PickerLayoutProps) {
  const [scanOpen, setScanOpen] = useState(false)
  const navigate = useNavigate()

  const handleScanned = useCallback(
    async (barcode: string) => {
      setScanOpen(false)
      try {
        const resolveRes = await resolveBarcode(barcode)
        if (resolveRes.type === 'PRODUCT' && resolveRes.product) {
          try {
            const inv = await getInventoryByBarcode(barcode)
            setBarcodeCache(barcode, inv)
            navigate('/picker', {
              state: {
                scanResult: {
                  product: {
                    product_id: inv.product_id,
                    name: inv.name,
                    barcode: inv.barcode,
                    locations: inv.best_locations,
                    fefo_lots: inv.fefo_lots,
                    total_available: inv.total_available,
                  },
                },
              },
            })
          } catch {
            const cached = getBarcodeCache(barcode)
            if (cached) {
              navigate('/picker', {
                state: {
                  scanResult: {
                    product: {
                      product_id: cached.product_id,
                      name: cached.name,
                      barcode: cached.barcode,
                      locations: cached.best_locations,
                      fefo_lots: cached.fefo_lots,
                      total_available: cached.total_available,
                    },
                    offline: true,
                  },
                },
              })
            } else {
              navigate('/picker', { state: { scanError: 'unknown' } })
            }
          }
        } else if (resolveRes.type === 'LOCATION' && resolveRes.entity_id) {
          navigate(`/picker/inventory?location=${resolveRes.entity_id}`)
        } else {
          navigate('/picker', { state: { scanError: resolveRes.message ?? 'unknown' } })
        }
      } catch {
        const cached = getBarcodeCache(barcode)
        if (cached) {
          navigate('/picker', {
            state: {
              scanResult: {
                product: {
                  product_id: cached.product_id,
                  name: cached.name,
                  barcode: cached.barcode,
                  locations: cached.best_locations,
                  fefo_lots: cached.fefo_lots,
                  total_available: cached.total_available,
                },
                offline: true,
              },
            },
          })
        } else {
          navigate('/picker', { state: { scanError: 'error' } })
        }
      }
    },
    [navigate]
  )

  return (
    <div className="min-h-screen pb-nav w-full max-w-xl mx-auto">
      {children}
      <PickerBottomNav onScanClick={() => setScanOpen(true)} />
      <ScanModal open={scanOpen} onClose={() => setScanOpen(false)} onScanned={handleScanned} />
    </div>
  )
}
