import type { ReactNode } from 'react'
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { ControllerBottomNav } from './ControllerBottomNav'
import { ScanModal } from '../picker/ScanModal'
import { resolveBarcode } from '../../services/scannerApi'
import { getInventoryByBarcode } from '../../services/pickerInventoryApi'
import { getBarcodeCache, setBarcodeCache } from '../../lib/barcodeCache'

type ControllerLayoutProps = {
  children: ReactNode
}

export function ControllerLayout({ children }: ControllerLayoutProps) {
  const { t } = useTranslation('controller')
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
            navigate('/controller', {
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
              navigate('/controller', {
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
              navigate('/controller', { state: { scanError: 'unknown' } })
            }
          }
        } else if (resolveRes.type === 'LOCATION' && resolveRes.entity_id) {
          navigate(`/controller/products?location=${resolveRes.entity_id}`)
        } else {
          navigate('/controller', { state: { scanError: resolveRes.message ?? 'unknown' } })
        }
      } catch {
        const cached = getBarcodeCache(barcode)
        if (cached) {
          navigate('/controller', {
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
          navigate('/controller', { state: { scanError: 'error' } })
        }
      }
    },
    [navigate]
  )

  return (
    <div className="flex flex-col h-dvh max-h-dvh overflow-hidden w-full max-w-xl mx-auto min-w-0">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden min-w-0">
        {children}
      </div>
      <ControllerBottomNav onScanClick={() => setScanOpen(true)} />
      <ScanModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScanned={handleScanned}
        title={t('scan.title')}
      />
    </div>
  )
}
