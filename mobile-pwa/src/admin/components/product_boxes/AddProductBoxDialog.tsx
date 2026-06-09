import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ProductSearchCombobox } from '../../../components/ProductSearchCombobox'
import { Button } from '../../../components/ui/button'
import { useAppToast } from '../../../feedback/useAppToast'
import { createProductBox } from '../../../services/productBoxesApi'
import type { Product } from '../../../services/productsApi'

type AddProductBoxDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function AddProductBoxDialog({ open, onOpenChange, onCreated }: AddProductBoxDialogProps) {
  const { t } = useTranslation(['productBoxes', 'common'])
  const { showError } = useAppToast()
  const [boxBarcode, setBoxBarcode] = useState('')
  const [unitsPerBox, setUnitsPerBox] = useState('')
  const [label, setLabel] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const reset = () => {
    setBoxBarcode('')
    setUnitsPerBox('')
    setLabel('')
    setSelectedProductId('')
    setSelectedProduct(null)
    setErrors({})
  }

  useEffect(() => {
    if (open) reset()
  }, [open])

  const visible = useMemo(() => open, [open])
  if (!visible) return null

  const validate = () => {
    const next: Record<string, string> = {}
    if (!boxBarcode.trim()) next.box_barcode = t('productBoxes:validation.box_barcode_required')
    if (!selectedProductId) next.product = t('productBoxes:validation.product_required')
    const units = Number(unitsPerBox)
    if (!unitsPerBox.trim() || !Number.isFinite(units) || units <= 0 || !Number.isInteger(units)) {
      next.units_per_box = t('productBoxes:validation.units_required')
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!validate()) return
    setIsSubmitting(true)
    try {
      await createProductBox({
        box_barcode: boxBarcode.trim(),
        product_id: selectedProductId,
        units_per_box: Number(unitsPerBox),
        label: label.trim() || undefined,
      })
      onCreated()
      reset()
      onOpenChange(false)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('productBoxes:validation.submit_failed')
      showError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label={t('common:close')}
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('productBoxes:add_title')}</h2>
          <button
            type="button"
            className="rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">{t('productBoxes:fields.box_barcode')}</label>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              value={boxBarcode}
              onChange={(e) => setBoxBarcode(e.target.value)}
              placeholder={t('productBoxes:placeholders.box_barcode')}
            />
            {errors.box_barcode ? (
              <p className="mt-1 text-xs text-red-600">{errors.box_barcode}</p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t('productBoxes:fields.product')}</label>
            <ProductSearchCombobox
              value={selectedProductId}
              displayLabel={selectedProduct ? `${selectedProduct.sku} — ${selectedProduct.name}` : undefined}
              onSelect={(product) => {
                setSelectedProduct(product)
                setSelectedProductId(product?.id ?? '')
              }}
              placeholder={t('productBoxes:placeholders.product_search')}
            />
            {errors.product ? <p className="mt-1 text-xs text-red-600">{errors.product}</p> : null}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t('productBoxes:fields.units_per_box')}</label>
            <input
              type="number"
              min={1}
              step={1}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              value={unitsPerBox}
              onChange={(e) => setUnitsPerBox(e.target.value)}
              placeholder="12"
            />
            {errors.units_per_box ? (
              <p className="mt-1 text-xs text-red-600">{errors.units_per_box}</p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t('productBoxes:fields.label')}</label>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('productBoxes:placeholders.label')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              <Plus className="mr-1 h-4 w-4" />
              {isSubmitting ? t('common:saving') : t('productBoxes:save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
