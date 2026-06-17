import { useEffect, useMemo, useState } from 'react'
import { Save, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import { useAppToast } from '../../../feedback/useAppToast'
import { updateProductBox, type ProductBox } from '../../../services/productBoxesApi'

type EditProductBoxDialogProps = {
  open: boolean
  item: ProductBox | null
  onOpenChange: (open: boolean) => void
  onUpdated: () => void
}

export function EditProductBoxDialog({
  open,
  item,
  onOpenChange,
  onUpdated,
}: EditProductBoxDialogProps) {
  const { t } = useTranslation(['productBoxes', 'common'])
  const { showError } = useAppToast()
  const [boxBarcode, setBoxBarcode] = useState('')
  const [unitsPerBox, setUnitsPerBox] = useState('')
  const [label, setLabel] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open || !item) return
    setBoxBarcode(item.box_barcode)
    setUnitsPerBox(String(item.units_per_box))
    setLabel(item.label ?? '')
    setErrors({})
  }, [open, item])

  const visible = useMemo(() => open && item != null, [open, item])
  if (!visible || !item) return null

  const validate = () => {
    const next: Record<string, string> = {}
    if (!boxBarcode.trim()) next.box_barcode = t('productBoxes:validation.box_barcode_required')
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
      await updateProductBox(item.id, {
        box_barcode: boxBarcode.trim(),
        units_per_box: Number(unitsPerBox),
        label: label.trim() || null,
      })
      onUpdated()
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
          <h2 className="text-lg font-semibold">{t('productBoxes:edit_title')}</h2>
          <button
            type="button"
            className="rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {item.product ? (
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
            {item.product.sku} — {item.product.name}
          </p>
        ) : null}
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">{t('productBoxes:fields.box_barcode')}</label>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              value={boxBarcode}
              onChange={(e) => setBoxBarcode(e.target.value)}
            />
            {errors.box_barcode ? (
              <p className="mt-1 text-xs text-red-600">{errors.box_barcode}</p>
            ) : null}
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
              <Save className="mr-1 h-4 w-4" />
              {isSubmitting ? t('common:saving') : t('productBoxes:save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
