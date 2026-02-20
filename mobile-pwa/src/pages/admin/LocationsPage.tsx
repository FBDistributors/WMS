import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Pencil, Plus, Printer, QrCode, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
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
    <TableScrollArea>
        <table className="w-full min-w-[640px] table-fixed text-left text-sm sm:table-auto">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="whitespace-nowrap pb-2 pr-3 font-semibold text-slate-700 dark:text-slate-300 sm:pr-4">
                {t('locations:fields.code')}
              </th>
              <th className="whitespace-nowrap pb-2 pr-3 font-semibold text-slate-700 dark:text-slate-300 sm:pr-4">
                {t('locations:type_label')}
              </th>
              <th className="whitespace-nowrap pb-2 pr-3 font-semibold text-slate-700 dark:text-slate-300 sm:pr-4">
                {t('locations:sector')}
              </th>
              <th className="whitespace-nowrap pb-2 pr-3 font-semibold text-slate-700 dark:text-slate-300 sm:pr-4">
                {t('locations:level_no')}
              </th>
              <th className="whitespace-nowrap pb-2 pr-3 font-semibold text-slate-700 dark:text-slate-300 sm:pr-4">
                {t('locations:row_no')}
              </th>
              <th className="whitespace-nowrap pb-2 pr-3 font-semibold text-slate-700 dark:text-slate-300 sm:pr-4">
                {t('locations:pallet_no')}
              </th>
              <th className="whitespace-nowrap pb-2 pr-3 font-semibold text-slate-700 dark:text-slate-300 sm:pr-4">
                {t('locations:pick_sequence')}
              </th>
              <th className="whitespace-nowrap pb-2 pr-3 font-semibold text-slate-700 dark:text-slate-300 sm:pr-4">
                {t('locations:status')}
              </th>
              <th className="whitespace-nowrap pb-2 pl-2 font-semibold text-slate-700 dark:text-slate-300">
                {t('locations:actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((loc) => (
              <tr key={loc.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="whitespace-nowrap py-2 pr-3 font-medium text-slate-900 dark:text-slate-100 sm:pr-4">
                  {loc.code}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-slate-600 dark:text-slate-400 sm:pr-4">
                  {loc.location_type ?? '—'}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-slate-600 dark:text-slate-400 sm:pr-4">{loc.sector ?? '—'}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-slate-600 dark:text-slate-400 sm:pr-4">
                  {loc.level_no != null ? loc.level_no : '—'}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-slate-600 dark:text-slate-400 sm:pr-4">
                  {loc.row_no != null ? loc.row_no : '—'}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-slate-600 dark:text-slate-400 sm:pr-4">
                  {loc.pallet_no != null ? loc.pallet_no : '—'}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-slate-600 dark:text-slate-400 sm:pr-4">
                  {loc.pick_sequence != null ? loc.pick_sequence : '—'}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 sm:pr-4">
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
                <td className="py-2 pl-2">
                  <div className="flex flex-nowrap items-center gap-0.5 sm:gap-1">
                    <Button
                      variant="ghost"
                      className="shrink-0 py-1.5 px-1.5 text-xs sm:px-2"
                      onClick={() => setDialog({ open: true, mode: 'edit', target: loc })}
                      aria-label={t('locations:edit')}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      className="shrink-0 py-1.5 px-1.5 text-xs sm:px-2"
                      onClick={() => setLocationForQr(loc)}
                      aria-label={t('locations:qr_download')}
                    >
                      <QrCode size={14} className="sm:mr-1 sm:inline" />
                      <span className="hidden sm:inline">{t('locations:qr_download')}</span>
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [error, isLoading, items, load, t])

  return (
    <AdminLayout
      title={t('locations:title')}
      actionSlot={
        <Button onClick={() => setDialog({ open: true, mode: 'create' })} className="shrink-0">
          <Plus size={16} />
          <span className="hidden sm:inline">{t('locations:add')}</span>
        </Button>
      }
    >
      <Card className="min-w-0 space-y-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-slate-900 dark:text-slate-100 sm:text-lg">
              {t('locations:title')}
            </div>
            <div className="break-words text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
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
  const [pickSequence, setPickSequence] = useState<number | ''>(target?.pick_sequence ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false)
  const [isDeactivating, setIsDeactivating] = useState(false)
  const [showActivateConfirm, setShowActivateConfirm] = useState(false)
  const [isActivating, setIsActivating] = useState(false)

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
          is_active: true,
        })
        onCreated?.(created)
      } else if (target) {
        await updateLocation(target.id, {
          sector: s,
          ...(locationType === 'RACK'
            ? { level_no: Number(levelNo), row_no: Number(rowNo), pallet_no: undefined }
            : { pallet_no: Number(palletNo), level_no: undefined, row_no: undefined }),
          is_active: target.is_active,
          pick_sequence: pickSequence === '' ? null : Number(pickSequence),
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

          {mode === 'edit' && (
            <label className="text-sm text-slate-600 dark:text-slate-300">
              {t('locations:pick_sequence')}
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                value={pickSequence === '' ? '' : pickSequence}
                onChange={(e) =>
                  setPickSequence(e.target.value === '' ? '' : parseInt(e.target.value, 10))
                }
                placeholder="—"
              />
            </label>
          )}

          {mode === 'edit' && target?.is_active && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
              <Button
                type="button"
                variant="danger"
                className="w-full"
                onClick={() => setShowDeactivateConfirm(true)}
                disabled={isSubmitting}
              >
                {t('locations:deactivate')}
              </Button>
            </div>
          )}
          {mode === 'edit' && target && !target.is_active && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
              <Button
                type="button"
                variant="secondary"
                className="w-full bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700"
                onClick={() => setShowActivateConfirm(true)}
                disabled={isSubmitting}
              >
                {t('locations:activate')}
              </Button>
            </div>
          )}

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

      <ConfirmDialog
        open={showDeactivateConfirm}
        title={t('locations:confirm_delete_title')}
        message={t('locations:confirm_delete_one', { code: target?.code ?? '' })}
        confirmLabel={t('locations:confirm_yes')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        loading={isDeactivating}
        onConfirm={async () => {
          if (!target) return
          setIsDeactivating(true)
          setError(null)
          try {
            await deactivateLocation(target.id)
            setShowDeactivateConfirm(false)
            onSaved()
            onClose()
          } catch (err: unknown) {
            const msg =
              typeof err === 'object' && err !== null && 'details' in err &&
              typeof (err as { details?: { detail?: string } }).details?.detail === 'string'
                ? (err as { details: { detail: string } }).details.detail
                : err instanceof Error ? err.message : t('locations:delete_failed')
            setError(msg)
            setShowDeactivateConfirm(false)
          } finally {
            setIsDeactivating(false)
          }
        }}
        onCancel={() => setShowDeactivateConfirm(false)}
      />
      <ConfirmDialog
        open={showActivateConfirm}
        title={t('locations:confirm_delete_title')}
        message={t('locations:confirm_activate_one', { code: target?.code ?? '' })}
        confirmLabel={t('locations:confirm_activate_yes')}
        cancelLabel={t('common:buttons.cancel')}
        loading={isActivating}
        onConfirm={async () => {
          if (!target) return
          setIsActivating(true)
          setError(null)
          try {
            await updateLocation(target.id, { is_active: true })
            setShowActivateConfirm(false)
            onSaved()
            onClose()
          } catch (err: unknown) {
            const msg =
              typeof err === 'object' && err !== null && 'details' in err &&
              typeof (err as { details?: { detail?: string } }).details?.detail === 'string'
                ? (err as { details: { detail: string } }).details.detail
                : err instanceof Error ? err.message : t('locations:save_failed')
            setError(msg)
            setShowActivateConfirm(false)
          } finally {
            setIsActivating(false)
          }
        }}
        onCancel={() => setShowActivateConfirm(false)}
      />
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
