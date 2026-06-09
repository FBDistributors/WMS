import type { PickingLine } from '../api/picking';
import { resolveScannerBarcode } from '../api/scanner';

export type PickScanResolve = {
  line: PickingLine;
  unitsPerScan: number;
  isBoxScan: boolean;
};

function productIdMatchesLine(productId: string, line: PickingLine): boolean {
  const pid = productId.trim();
  if (!pid) return false;
  return (line.product_id ?? '').trim() === pid;
}

export function findLineByProductId(lines: PickingLine[], productId: string): PickingLine | null {
  const matches = lines.filter((l) => productIdMatchesLine(productId, l));
  if (matches.length === 0) return null;
  const open = matches.find((l) => (l.qty_picked ?? 0) < (l.qty_required ?? 0));
  return open ?? matches[0];
}

export function barcodeMatchesLine(value: string, line: PickingLine): boolean {
  const v = value.trim().toLowerCase();
  if (line.barcode && line.barcode.toLowerCase() === v) return true;
  if (line.sku && line.sku.toLowerCase() === v) return true;
  return false;
}

export async function resolvePickScanForDocument(params: {
  lines: PickingLine[];
  barcode: string;
  preferredLineId?: string;
}): Promise<PickScanResolve | null> {
  const normalized = params.barcode.trim();
  if (!normalized) return null;
  try {
    const out = await resolveScannerBarcode(normalized);
    if (out.type === 'PRODUCT' && out.product?.id) {
      const isBox = out.scan_kind === 'box' && (out.units_per_scan ?? 0) > 0;
      const units = out.units_per_scan ?? 1;
      let line: PickingLine | null = null;
      if (params.preferredLineId) {
        line = params.lines.find((l) => l.id === params.preferredLineId) ?? null;
        if (!line) return null;
        if (isBox) {
          if (!productIdMatchesLine(out.product.id, line)) return null;
        } else if (!barcodeMatchesLine(normalized, line)) {
          return null;
        }
      } else if (isBox) {
        line = findLineByProductId(params.lines, out.product.id);
      } else {
        line =
          params.lines.find((l) => barcodeMatchesLine(normalized, l)) ?? null;
      }
      if (!line) return null;
      return { line, unitsPerScan: units, isBoxScan: isBox };
    }
  } catch {
    /* offline */
  }
  const fallback =
    params.lines.find((l) => barcodeMatchesLine(normalized, l)) ?? null;
  if (!fallback) return null;
  return { line: fallback, unitsPerScan: 1, isBoxScan: false };
}
