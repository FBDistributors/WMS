import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Pencil, Plus, Printer, QrCode, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  createLocation,
  deactivateLocation,
  getLocations,
  updateLocation,
  type Location,
  type LocationTypeEnum,
} from '../../services/locationsApi'

/** Live preview of code from structured fields (same formula as backend). */
function previewCode(
  locationType: LocationTypeEnum,
  sector: string,
  levelNo: number | null,
  rowNo: number | null,
  palletNo: number | null
): string {
  const s = (sector || '').trim()
  if (!s) return '—'
  if (locationType === 'RACK') {
    if (levelNo == null || rowNo == null) return '—'
    return `S-${s}-${String(levelNo).padStart(2, '0')}-${String(rowNo).padStart(2, '0')}`
  }
  if (locationType === 'FLOOR') {
    if (palletNo == null) return '—'
    return `P-${s}-${String(palletNo).padStart(2, '0')}`
  }
  return '—'
}

type DialogState = {
  open: boolean
  mode: 'create' | 'edit'
  target?: Location
}

export function LocationsPage() {
  const { t } = useTranslation(['locations', 'common'])
  const [items, setItems] = useState<Location[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>({ open: false, mode: 'create' })
  const [createdForBarcode, setCreatedForBarcode] = useState<Location | null>(null)
  const [locationForQr, setLocationForQr] = useState<Location | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmSingle, setConfirmSingle] = useState<Location | null>(null)
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getLocations(includeInactive)
      setItems(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('locations:load_failed')
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [includeInactive, t])

  useEffect(() => {
    void load()
  }, [load])

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return (
        <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
      )
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('locations:empty')}
          description={t('locations:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="w-10 pb-2 pr-2 font-semibold text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={items.length > 0 && selectedIds.size === items.length}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedIds(new Set(items.map((l) => l.id)))
                    else setSelectedIds(new Set())
                  }}
                  aria-label={t('locations:select_all')}
                />
              </th>
              <th className="pb-2 pr-4 font-semibold text-slate-700 dark:text-slate-300">
                {t('locations:fields.code')}
              </th>
              <th className="pb-2 pr-4 font-semibold text-slate-700 dark:text-slate-300">
                {t('locations:type_label')}
              </th>
              <th className="pb-2 pr-4 font-semibold text-slate-700 dark:text-slate-300">
                {t('locations:sector')}
              </th>
              <th className="pb-2 pr-4 font-semibold text-slate-700 dark:text-slate-300">
                {t('locations:level_no')}
              </th>
              <th className="pb-2 pr-4 font-semibold text-slate-700 dark:text-slate-300">
                {t('locations:row_no')}
              </th>
              <th className="pb-2 pr-4 font-semibold text-slate-700 dark:text-slate-300">
                {t('locations:pallet_no')}
              </th>
              <th className="pb-2 pr-4 font-semibold text-slate-700 dark:text-slate-300">
                {t('locations:status')}
              </th>
              <th className="pb-2 font-semibold text-slate-700 dark:text-slate-300">
                {t('locations:actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((loc) => (
              <tr key={loc.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="w-10 py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(loc.id)}
                    onChange={(e) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(loc.id)
                        else next.delete(loc.id)
                        return next
                      })
                    }}
                    aria-label={t('locations:select_one')}
                  />
                </td>
                <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100">
                  {loc.code}
                </td>
                <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">
                  {loc.location_type ?? '—'}
                </td>
                <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">{loc.sector ?? '—'}</td>
                <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">
                  {loc.level_no != null ? loc.level_no : '—'}
                </td>
                <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">
                  {loc.row_no != null ? loc.row_no : '—'}
                </td>
                <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">
                  {loc.pallet_no != null ? loc.pallet_no : '—'}
                </td>
                <td className="py-2 pr-4">
                  {loc.is_active ? (
                    <span className="text-green-600 dark:text-green-400">
                      {t('locations:active')}
                    </span>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">
                      {t('locations:inactive')}
                    </span>
                  )}
                </td>
                <td className="py-2 flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    className="py-1.5 px-2 text-xs"
                    onClick={() => setDialog({ open: true, mode: 'edit', target: loc })}
                    aria-label={t('locations:edit')}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    className="py-1.5 px-2 text-xs"
                    onClick={() => setLocationForQr(loc)}
                  >
                    <QrCode size={14} className="mr-1 inline" />
                    {t('locations:qr_download')}
                  </Button>
                  {loc.is_active ? (
                    <Button
                      variant="ghost"
                      className="py-1.5 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10"
                      onClick={() => setConfirmSingle(loc)}
                      aria-label={t('locations:delete_one')}
                    >
                      <Trash2 size={14} />
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }, [error, isLoading, items, load, selectedIds, t])

  return (
    <AdminLayout
      title={t('locations:title')}
      actionSlot={
        <Button onClick={() => setDialog({ open: true, mode: 'create' })}>
          <Plus size={16} />
          {t('locations:add')}
        </Button>
      }
    >
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('locations:title')}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t('locations:subtitle')}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              {t('locations:show_inactive')}
            </label>
            {selectedIds.size > 0 ? (
              <Button
                variant="danger"
                className="gap-1 text-sm"
                onClick={() => setConfirmBulk(true)}
              >
                <Trash2 size={16} />
                {t('locations:delete_selected')} ({selectedIds.size})
              </Button>
            ) : null}
          </div>
        </div>
        {content}
      </Card>

      {dialog.open ? (
        <LocationDialog
          mode={dialog.mode}
          target={dialog.target}
          onClose={() => setDialog({ open: false, mode: 'create' })}
          onSaved={load}
          onCreated={(loc) => {
            setCreatedForBarcode(loc)
            setDialog({ open: false, mode: 'create' })
            load()
          }}
        />
      ) : null}
      {createdForBarcode ? (
        <BarcodeLabelDialog
          location={createdForBarcode}
          onClose={() => setCreatedForBarcode(null)}
        />
      ) : null}
      {locationForQr ? (
        <QrDownloadDialog
          location={locationForQr}
          onClose={() => setLocationForQr(null)}
        />
      ) : null}
      <ConfirmDialog
        open={!!confirmSingle}
        title={t('locations:confirm_delete_title')}
        message={t('locations:confirm_delete_one', { code: confirmSingle?.code ?? '' })}
        confirmLabel={t('locations:confirm_yes')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        loading={isDeleting}
        onConfirm={async () => {
          if (!confirmSingle) return
          setIsDeleting(true)
          try {
            await deactivateLocation(confirmSingle.id)
            setConfirmSingle(null)
            await load()
          } finally {
            setIsDeleting(false)
          }
        }}
        onCancel={() => setConfirmSingle(null)}
      />
      <ConfirmDialog
        open={confirmBulk}
        title={t('locations:confirm_delete_title')}
        message={t('locations:confirm_delete_selected', { count: selectedIds.size })}
        confirmLabel={t('locations:confirm_yes')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        loading={isDeleting}
        onConfirm={async () => {
          setIsDeleting(true)
          try {
            for (const id of selectedIds) {
              await deactivateLocation(id)
            }
            setSelectedIds(new Set())
            setConfirmBulk(false)
            await load()
          } finally {
            setIsDeleting(false)
          }
        }}
        onCancel={() => setConfirmBulk(false)}
      />
    </AdminLayout>
  )
}

type DialogProps = {
  mode: 'create' | 'edit'
  target?: Location
  onClose: () => void
  onSaved: () => void
  onCreated?: (location: Location) => void
}

function LocationDialog({ mode, target, onClose, onSaved, onCreated }: DialogProps) {
  const { t } = useTranslation(['locations', 'common'])
  const [locationType, setLocationType] = useState<LocationTypeEnum>(
    (target?.location_type as LocationTypeEnum) ?? 'RACK'
  )
  const [sector, setSector] = useState(target?.sector ?? '')
  const [levelNo, setLevelNo] = useState<number | ''>(target?.level_no ?? '')
  const [rowNo, setRowNo] = useState<number | ''>(target?.row_no ?? '')
  const [palletNo, setPalletNo] = useState<number | ''>(target?.pallet_no ?? '')
  const [isActive, setIsActive] = useState(target?.is_active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const preview = useMemo(
    () =>
      previewCode(
        locationType,
        sector,
        levelNo === '' ? null : Number(levelNo),
        rowNo === '' ? null : Number(rowNo),
        palletNo === '' ? null : Number(palletNo)
      ),
    [locationType, sector, levelNo, rowNo, palletNo]
  )

  const handleSubmit = async () => {
    const s = sector.trim()
    if (!s) {
      setError(t('locations:validation.sector_required'))
      return
    }
    if (locationType === 'RACK') {
      if (levelNo === '' || rowNo === '') {
        setError(t('locations:validation.level_row_required'))
        return
      }
      if (Number(levelNo) < 0 || Number(levelNo) > 99 || Number(rowNo) < 0 || Number(rowNo) > 99) {
        setError(t('locations:validation.level_row_range'))
        return
      }
    }
    if (locationType === 'FLOOR') {
      if (palletNo === '') {
        setError(t('locations:validation.pallet_required'))
        return
      }
      if (Number(palletNo) < 0 || Number(palletNo) > 99) {
        setError(t('locations:validation.pallet_range'))
        return
      }
    }
    setIsSubmitting(true)
    setError(null)
    try {
      if (mode === 'create') {
        const created = await createLocation({
          location_type: locationType,
          sector: s,
          ...(locationType === 'RACK'
            ? { level_no: Number(levelNo), row_no: Number(rowNo) }
            : { pallet_no: Number(palletNo) }),
          is_active: isActive,
        })
        onCreated?.(created)
      } else if (target) {
        await updateLocation(target.id, {
          sector: s,
          ...(locationType === 'RACK'
            ? { level_no: Number(levelNo), row_no: Number(rowNo), pallet_no: undefined }
            : { pallet_no: Number(palletNo), level_no: undefined, row_no: undefined }),
          is_active: isActive,
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('locations:save_failed')
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label={t('common:buttons.close')}
        type="button"
      />
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {mode === 'create' ? t('locations:add') : t('locations:edit')}
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <div className="space-y-3 px-6 py-5">
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
              {error}
            </div>
          ) : null}

          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('locations:type_label')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={locationType}
              onChange={(e) => setLocationType(e.target.value as LocationTypeEnum)}
              disabled={mode === 'edit'}
            >
              <option value="RACK">{t('locations:types_enum.RACK')}</option>
              <option value="FLOOR">{t('locations:types_enum.FLOOR')}</option>
            </select>
          </label>

          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('locations:sector')} *
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="e.g. 15 or AS"
            />
          </label>

          {locationType === 'RACK' ? (
            <>
              <label className="text-sm text-slate-600 dark:text-slate-300">
                {t('locations:level_no')} *
                <input
                  type="number"
                  min={0}
                  max={99}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                  value={levelNo === '' ? '' : levelNo}
                  onChange={(e) => setLevelNo(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                />
              </label>
              <label className="text-sm text-slate-600 dark:text-slate-300">
                {t('locations:row_no')} *
                <input
                  type="number"
                  min={0}
                  max={99}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                  value={rowNo === '' ? '' : rowNo}
                  onChange={(e) => setRowNo(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                />
              </label>
            </>
          ) : (
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('locations:pallet_no')} *
              <input
                type="number"
                min={0}
                max={99}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={palletNo === '' ? '' : palletNo}
                onChange={(e) =>
                  setPalletNo(e.target.value === '' ? '' : parseInt(e.target.value, 10))
                }
              />
            </label>
          )}

          <div className="rounded-2xl bg-slate-100 px-4 py-2 text-sm dark:bg-slate-800">
            <span className="text-slate-500 dark:text-slate-400">{t('locations:preview_code')}: </span>
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
              {preview}
            </span>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            {t('locations:fields.active')}
          </label>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common:buttons.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? t('locations:saving') : t('locations:save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

type BarcodeLabelDialogProps = {
  location: Location
  onClose: () => void
}

function BarcodeLabelDialog({ location, onClose }: BarcodeLabelDialogProps) {
  const { t } = useTranslation(['locations', 'common'])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const value = location.barcode_value || location.code

  useEffect(() => {
    if (!canvasRef.current || !value) return
    try {
      JsBarcode(canvasRef.current, value, {
        format: 'CODE128',
        displayValue: true,
        width: 2,
        height: 60,
      })
    } catch {
      // ignore invalid barcode
    }
  }, [value])

  const handleDownloadPng = () => {
    if (!canvasRef.current) return
    const dataUrl = canvasRef.current.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `location-${value}.png`
    a.click()
  }

  const handlePrint = () => {
    if (!canvasRef.current) return
    const dataUrl = canvasRef.current.toDataURL('image/png')
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`
      <!DOCTYPE html><html><head><title>${value}</title></head>
      <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:sans-serif;">
        <p style="font-size:18px;font-weight:bold;margin-bottom:8px;">${value}</p>
        <img src="${dataUrl}" alt="${value}" />
      </body></html>
    `)
    w.document.close()
    w.focus()
    w.print()
    w.close()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label={t('common:buttons.close')}
        type="button"
      />
      <div className="relative w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('locations:barcode_label')}
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <div className="flex flex-col items-center gap-4">
          <p className="text-center font-mono text-sm font-medium text-slate-700 dark:text-slate-300">
            {value}
          </p>
          <canvas ref={canvasRef} className="max-w-full" />
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={handlePrint} className="gap-2">
            <Printer size={16} />
            {t('locations:print_label')}
          </Button>
          <Button variant="secondary" onClick={handleDownloadPng} className="gap-2">
            <Download size={16} />
            {t('locations:download_png')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common:buttons.close')}
          </Button>
        </div>
      </div>
    </div>
  )
}

type QrDownloadDialogProps = {
  location: Location
  onClose: () => void
}

function QrDownloadDialog({ location, onClose }: QrDownloadDialogProps) {
  const { t } = useTranslation(['locations', 'common'])
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const value = location.barcode_value || location.code

  useEffect(() => {
    if (!value) return
    QRCode.toDataURL(value, { width: 256, margin: 2 })
      .then(setDataUrl)
      .catch(() => {})
  }, [value])

  const handleDownloadPng = () => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `location-qr-${value}.png`
    a.click()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label={t('common:buttons.close')}
        type="button"
      />
      <div className="relative w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('locations:qr_label_title')}
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <div className="flex flex-col items-center gap-4">
          <p className="text-center font-mono text-sm font-medium text-slate-700 dark:text-slate-300">
            {value}
          </p>
          {dataUrl ? (
            <img
              src={dataUrl}
              alt=""
              className="rounded-lg border border-slate-200 dark:border-slate-700"
              width={256}
              height={256}
            />
          ) : (
            <div className="h-64 w-64 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
          )}
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={handleDownloadPng} className="gap-2" disabled={!dataUrl}>
            <Download size={16} />
            {t('locations:download_png')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common:buttons.close')}
          </Button>
        </div>
      </div>
    </div>
  )
}
