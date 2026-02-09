import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import { createProduct } from '../../../services/productsApi'

type AddProductDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

type FormState = {
  sku: string
  name: string
  brand: string
  category: string
  status: 'active' | 'inactive'
  photo_url: string
  barcodes: string[]
}

const defaultState: FormState = {
  sku: '',
  name: '',
  brand: '',
  category: '',
  status: 'active',
  photo_url: '',
  barcodes: [''],
}

const barcodePattern = /^\d{8,14}$/

export function AddProductDialog({ open, onOpenChange, onCreated }: AddProductDialogProps) {
  const { t } = useTranslation(['products', 'common'])
  const [form, setForm] = useState<FormState>(defaultState)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const reset = () => {
    setForm(defaultState)
    setErrors({})
    setSubmitError(null)
  }

  useEffect(() => {
    if (open) {
      reset()
    }
  }, [open])

  const visible = useMemo(() => open, [open])
  if (!visible) return null

  const validate = () => {
    const nextErrors: Record<string, string> = {}
    if (!form.sku.trim()) nextErrors.sku = t('products:validation.sku_required')
    if (!form.name.trim()) nextErrors.name = t('products:validation.name_required')
    const cleaned = form.barcodes.map((item) => item.trim()).filter(Boolean)
    for (const value of cleaned) {
      if (!barcodePattern.test(value)) {
        nextErrors.barcodes = t('products:validation.barcode_format')
        break
      }
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!validate()) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      await createProduct({
        sku: form.sku.trim(),
        name: form.name.trim(),
        brand: form.brand.trim() || undefined,
        category: form.category.trim() || undefined,
        status: form.status,
        photo_url: form.photo_url.trim() || undefined,
        barcodes: form.barcodes.map((item) => item.trim()).filter(Boolean),
      })
      onCreated()
      reset()
      onOpenChange(false)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('products:validation.submit_failed')
      setSubmitError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-label={t('common:buttons.close')}
        type="button"
      />
      <div className="relative w-full max-w-xl rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('products:add.title')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('products:add.subtitle')}
            </p>
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={() => onOpenChange(false)}>
            <X size={18} />
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {submitError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
              {submitError}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('products:fields.sku')}
              <input
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={form.sku}
                onChange={(event) => setForm((prev) => ({ ...prev, sku: event.target.value }))}
              />
              {errors.sku ? <div className="mt-1 text-xs text-red-500">{errors.sku}</div> : null}
            </label>
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('products:fields.name')}
              <input
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
              {errors.name ? <div className="mt-1 text-xs text-red-500">{errors.name}</div> : null}
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('products:fields.brand')}
              <input
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={form.brand}
                onChange={(event) => setForm((prev) => ({ ...prev, brand: event.target.value }))}
              />
            </label>
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('products:fields.category')}
              <input
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={form.category}
                onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('products:fields.status')}
              <select
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={form.status}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, status: event.target.value as FormState['status'] }))
                }
              >
                <option value="active">{t('common:status.active')}</option>
                <option value="inactive">{t('common:status.inactive')}</option>
              </select>
            </label>
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('products:fields.photo_url')}
              <input
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={form.photo_url}
                onChange={(event) => setForm((prev) => ({ ...prev, photo_url: event.target.value }))}
              />
            </label>
          </div>
          <div>
            <div className="mb-2 text-sm text-slate-600 dark:text-slate-300">
              {t('products:fields.barcodes')}
            </div>
            <div className="space-y-2">
              {form.barcodes.map((barcode, index) => (
                <div key={`${index}-${barcode}`} className="flex items-center gap-2">
                  <input
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                    value={barcode}
                    onChange={(event) => {
                      const next = [...form.barcodes]
                      next[index] = event.target.value
                      setForm((prev) => ({ ...prev, barcodes: next }))
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-3 py-3"
                    onClick={() => {
                      setForm((prev) => ({
                        ...prev,
                        barcodes: prev.barcodes.filter((_, idx) => idx !== index),
                      }))
                    }}
                  >
                    <X size={16} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => setForm((prev) => ({ ...prev, barcodes: [...prev.barcodes, ''] }))}
              >
                <Plus size={16} />
                {t('products:add.add_barcode')}
              </Button>
              {errors.barcodes ? (
                <div className="text-xs text-red-500">{errors.barcodes}</div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                reset()
                onOpenChange(false)
              }}
            >
              {t('common:buttons.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('products:add.saving') : t('products:add.save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
