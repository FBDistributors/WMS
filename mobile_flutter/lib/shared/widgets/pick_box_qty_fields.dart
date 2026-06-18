import 'dart:async' show unawaited;
import 'dart:math' show max, min;

import 'package:flutter/material.dart';

import '../../core/app_state/app_locale.dart';
import '../../features/picking/data/picking_models.dart';
import '../../l10n/string_lookup.dart';
import '../input/input_clear_button.dart';
import '../input/stock_quantity_input.dart';
import 'scan_action_button.dart';

/// Terish modali: Dona / Quti bo'yicha (kirim uslubida).
class PickBoxQtyFields extends StatelessWidget {
  const PickBoxQtyFields({
    super.key,
    required this.loc,
    required this.mode,
    required this.onModeChanged,
    required this.unitQty,
    required this.boxCount,
    required this.unitsPerBox,
    required this.maxUnits,
    required this.onFieldsChanged,
    this.looseUnits,
  });

  final AppLocale loc;
  final String mode;
  final ValueChanged<String> onModeChanged;
  final TextEditingController unitQty;
  final TextEditingController boxCount;
  final int? unitsPerBox;
  final double maxUnits;
  final VoidCallback onFieldsChanged;
  final int? looseUnits;

  void _syncBoxQty() {
    final int? upb = unitsPerBox;
    final int bc = int.tryParse(boxCount.text.trim()) ?? 0;
    if (upb != null && bc > 0) {
      final int total = upb * bc;
      final int capped = min(total, maxUnits.round());
      unitQty.text = '$capped';
    }
    onFieldsChanged();
  }

  @override
  Widget build(BuildContext context) {
    final int? upb = unitsPerBox;
    final int bc = int.tryParse(boxCount.text.trim()) ?? 0;
    final int? totalUnits = upb != null && bc > 0 ? upb * bc : null;
    final int maxPick = max(0, maxUnits.round());
    final int? loose = looseUnits;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SegmentedButton<String>(
          segments: <ButtonSegment<String>>[
            ButtonSegment<String>(
              value: 'byUnit',
              label: Text(StringLookup.t(loc, 'kirimNewQtyTabByUnit')),
            ),
            ButtonSegment<String>(
              value: 'byBox',
              label: Text(StringLookup.t(loc, 'kirimNewQtyTabByBox')),
            ),
          ],
          selected: <String>{mode},
          onSelectionChanged: (Set<String> sel) {
            if (sel.isEmpty) {
              return;
            }
            onModeChanged(sel.first);
          },
        ),
        if (loose != null &&
            loose < maxPick &&
            (unitsPerBox ?? 0) > 0 &&
            mode == 'byUnit') ...<Widget>[
          const SizedBox(height: 8),
          Text(
            StringLookup.t(loc, 'pickUseBoxScan'),
            style: TextStyle(fontSize: 12, color: Colors.orange.shade800),
          ),
        ],
        const SizedBox(height: 12),
        if (mode == 'byBox') ...<Widget>[
          InputDecorator(
            decoration: InputDecoration(
              labelText: StringLookup.t(loc, 'kirimNewUnitsPerBox'),
              border: const OutlineInputBorder(),
            ),
            child: Text(
              upb?.toString() ?? '—',
              style: TextStyle(
                fontSize: 16,
                color: upb != null ? null : Colors.grey.shade600,
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: boxCount,
            keyboardType: kStockQtyKeyboardType,
            inputFormatters: kStockQtyInputFormatters,
            decoration: InputDecoration(
              labelText: StringLookup.t(loc, 'kirimNewBoxCount'),
              border: const OutlineInputBorder(),
              suffixIcon: buildInputClearButton(
                visible:
                    boxCount.text.trim().isNotEmpty && boxCount.text.trim() != '1',
                onPressed: () {
                  boxCount.text = '1';
                  _syncBoxQty();
                },
              ),
            ),
            onChanged: (_) => _syncBoxQty(),
          ),
          if (totalUnits != null) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              StringLookup.tParams(
                loc,
                'kirimNewTotalUnits',
                <String, String>{'total': '${min(totalUnits, maxPick)}'},
              ),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ],
        ] else ...<Widget>[
          TextField(
            controller: unitQty,
            keyboardType: kStockQtyKeyboardType,
            inputFormatters: kStockQtyInputFormatters,
            decoration: InputDecoration(
              labelText: StringLookup.t(loc, 'qtyShort'),
              border: const OutlineInputBorder(),
              suffixIcon: buildInputClearButton(
                visible: unitQty.text.trim().isNotEmpty,
                onPressed: () {
                  unitQty.clear();
                  onFieldsChanged();
                },
              ),
            ),
            onChanged: (_) => onFieldsChanged(),
          ),
        ],
      ],
    );
  }
}

/// Quti skan natijasiga qarab terish miqdorini hisoblash.
int pickQtyFromBoxMode({
  required String mode,
  required TextEditingController unitQty,
  required TextEditingController boxCount,
  required int? unitsPerBox,
  required double maxUnits,
}) {
  final int maxPick = max(0, maxUnits.round());
  if (mode == 'byBox') {
    final int upb = unitsPerBox ?? 0;
    final int bc = int.tryParse(boxCount.text.trim()) ?? 0;
    if (upb < 1 || bc < 1) {
      return 0;
    }
    return min(upb * bc, maxPick);
  }
  return int.tryParse(unitQty.text.trim()) ?? 0;
}

int? pickBoxCountForSubmit({
  required String mode,
  required TextEditingController boxCount,
  required int? unitsPerBox,
}) {
  if (mode != 'byBox' || (unitsPerBox ?? 0) < 1) {
    return null;
  }
  final int bc = int.tryParse(boxCount.text.trim()) ?? 0;
  return bc > 0 ? bc : null;
}

/// Gibrid terish: quti soni + qo'shimcha dona natijasi.
class PickHybridQty {
  const PickHybridQty({
    required this.total,
    required this.boxUnits,
    required this.looseUnits,
    required this.boxCount,
    required this.valid,
  });

  final int total;
  final int boxUnits;
  final int looseUnits;
  final int boxCount;
  final bool valid;
}

PickHybridQty computePickHybridQty({
  required int boxCount,
  required int looseQty,
  required int? unitsPerBox,
  required double maxUnits,
}) {
  final int maxPick = max(0, maxUnits.round());
  final int bc = max(0, boxCount);
  final int loose = max(0, looseQty);
  final int? upb = unitsPerBox;
  if (bc > 0 && (upb == null || upb < 1)) {
    return PickHybridQty(
      total: 0,
      boxUnits: 0,
      looseUnits: loose,
      boxCount: bc,
      valid: false,
    );
  }
  final int boxUnits = bc > 0 && upb != null ? bc * upb : 0;
  final int total = min(boxUnits + loose, maxPick);
  final int effectiveBoxUnits =
      bc > 0 && upb != null ? min(boxUnits, total) : 0;
  final int effectiveLoose = total - effectiveBoxUnits;
  final bool valid = total >= 1 && total <= maxPick && (bc == 0 || upb! >= 1);
  return PickHybridQty(
    total: total,
    boxUnits: effectiveBoxUnits,
    looseUnits: effectiveLoose,
    boxCount: bc,
    valid: valid,
  );
}

PickHybridQty pickHybridQtyFromControllers({
  required TextEditingController boxCount,
  required TextEditingController looseQty,
  required int? unitsPerBox,
  required double maxUnits,
}) {
  return computePickHybridQty(
    boxCount: int.tryParse(boxCount.text.trim()) ?? 0,
    looseQty: int.tryParse(looseQty.text.trim()) ?? 0,
    unitsPerBox: unitsPerBox,
    maxUnits: maxUnits,
  );
}

/// Gibrid miqdorni qolgan chegaraga sig'dirish (avval dona, keyin quti kamayadi).
void capHybridQtyToMax({
  required TextEditingController boxCount,
  required TextEditingController looseQty,
  required int? unitsPerBox,
  required double maxUnits,
}) {
  final int maxPick = max(0, maxUnits.round());
  int bc = max(0, int.tryParse(boxCount.text.trim()) ?? 0);
  int loose = max(0, int.tryParse(looseQty.text.trim()) ?? 0);
  final int upb = unitsPerBox ?? 0;

  int total() => (bc > 0 && upb >= 1 ? bc * upb : 0) + loose;

  while (total() > maxPick) {
    if (loose > 0) {
      loose--;
    } else if (bc > 0 && upb >= 1) {
      bc--;
    } else {
      break;
    }
  }
  boxCount.text = '$bc';
  looseQty.text = '$loose';
}

/// Qolgan miqdorga qarab quti + qo'shimcha dona maydonlarini to'ldirish.
void applyHybridQtyDefaults({
  required TextEditingController boxCount,
  required TextEditingController looseQty,
  required int? unitsPerBox,
  required double maxUnits,
}) {
  final int maxPick = max(0, maxUnits.round());
  final int upb = unitsPerBox ?? 0;
  if (upb < 1 || maxPick < 1) {
    boxCount.text = '0';
    looseQty.text = '$maxPick';
    return;
  }
  boxCount.text = '${maxPick ~/ upb}';
  looseQty.text = '${maxPick % upb}';
}

int? unitsPerBoxFromAlternateLocations(List<PickingAlternateLocation> alternates) {
  for (final PickingAlternateLocation a in alternates) {
    final int? upb = _unitsPerBoxFromAlternate(a);
    if (upb != null) {
      return upb;
    }
  }
  return null;
}

int? _unitsPerBoxFromAlternate(PickingAlternateLocation a) {
  final int boxes = a.boxCount ?? 0;
  final int units = a.unitsInBoxes ?? 0;
  if (boxes < 1 || units < 1) {
    return null;
  }
  final int upb = units ~/ boxes;
  return upb >= 1 ? upb : null;
}

/// Asosiy lokatsiyada qutisiz qoldiq va quti soni (ogohlantirish / upb uchun).
({int? looseUnits, int? boxCount}) primaryAlternateBoxHint(
  List<PickingAlternateLocation> alternates,
) {
  for (final PickingAlternateLocation a in alternates) {
    if (a.isPrimary) {
      return (looseUnits: a.looseUnits, boxCount: a.boxCount);
    }
  }
  return (looseUnits: null, boxCount: null);
}

/// Terish qatori lokatsiyasi bo'yicha qutisiz/quti zaxira (kod bo'yicha).
({int? looseUnits, int? boxCount}) alternateBoxHintForLocation(
  List<PickingAlternateLocation> alternates,
  String locationCode,
) {
  final String code = locationCode.trim().toLowerCase();
  if (code.isNotEmpty) {
    for (final PickingAlternateLocation a in alternates) {
      if (a.locationCode.trim().toLowerCase() == code) {
        return (looseUnits: a.looseUnits, boxCount: a.boxCount);
      }
    }
  }
  return primaryAlternateBoxHint(alternates);
}

/// Quti soni 0 bo'lsa quti barcode maydonini tozalash.
void syncHybridBoxBarcodeWithQty({
  required TextEditingController boxCount,
  TextEditingController? boxBarcode,
}) {
  if (boxBarcode == null) {
    return;
  }
  final int bc = int.tryParse(boxCount.text.trim()) ?? 0;
  if (bc < 1 && boxBarcode.text.isNotEmpty) {
    boxBarcode.clear();
  }
}

int? hybridUnitsPerBoxHint({
  required int? unitsPerBox,
  required List<PickingAlternateLocation> alternates,
}) {
  if (unitsPerBox != null && unitsPerBox >= 1) {
    return unitsPerBox;
  }
  return unitsPerBoxFromAlternateLocations(alternates);
}

bool hybridShowBoxOnlyHint({
  int? looseUnits,
  int? stockBoxCount,
}) {
  if (looseUnits == 0) {
    return true;
  }
  return (stockBoxCount ?? 0) > 0 && looseUnits == null;
}

/// Terish: quti + qutisiz dona bitta panelda (skan avval, soni keyin).
class PickHybridQtyFields extends StatelessWidget {
  const PickHybridQtyFields({
    super.key,
    required this.loc,
    required this.boxCount,
    required this.looseQty,
    required this.unitsPerBox,
    required this.maxUnits,
    required this.onFieldsChanged,
    this.looseUnits,
    this.stockBoxCount,
    this.boxBarcode,
    this.productBarcode,
    this.onBoxBarcodeChanged,
    this.onProductBarcodeChanged,
    this.onScanBox,
    this.onScanProduct,
    this.onBoxBarcodeSubmitted,
    this.onProductBarcodeSubmitted,
    this.busy = false,
  });

  final AppLocale loc;
  final TextEditingController boxCount;
  final TextEditingController looseQty;
  final int? unitsPerBox;
  final double maxUnits;
  final VoidCallback onFieldsChanged;
  final int? looseUnits;
  final int? stockBoxCount;
  final TextEditingController? boxBarcode;
  final TextEditingController? productBarcode;
  final VoidCallback? onBoxBarcodeChanged;
  final VoidCallback? onProductBarcodeChanged;
  final VoidCallback? onScanBox;
  final VoidCallback? onScanProduct;
  final Future<void> Function(String code)? onBoxBarcodeSubmitted;
  final Future<void> Function(String code)? onProductBarcodeSubmitted;
  final bool busy;

  Widget _barcodeScanRow({
    required TextEditingController controller,
    required String label,
    required VoidCallback? onScan,
    required Future<void> Function(String code)? onSubmitted,
    required VoidCallback? onChanged,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: <Widget>[
        Expanded(
          child: TextField(
            controller: controller,
            enabled: !busy,
            decoration: InputDecoration(
              labelText: label,
              border: const OutlineInputBorder(),
            ),
            onChanged: (_) => onChanged?.call(),
            onSubmitted: (String v) {
              final Future<void> Function(String code)? handler = onSubmitted;
              if (handler != null) {
                unawaited(handler(v));
              }
            },
          ),
        ),
        const SizedBox(width: 8),
        ScanActionButton(
          onPressed: busy || onScan == null ? null : onScan,
          label: label,
          compact: true,
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final int? upb = unitsPerBox;
    final bool canEditBoxCount = upb != null && upb >= 1;
    final PickHybridQty hybrid = pickHybridQtyFromControllers(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: upb,
      maxUnits: maxUnits,
    );
    final bool showBoxOnlyHint = hybridShowBoxOnlyHint(
      looseUnits: looseUnits,
      stockBoxCount: stockBoxCount,
    );
    final bool showHybridScans =
        canEditBoxCount && boxBarcode != null && productBarcode != null;

    if (upb == null || upb < 1) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (showBoxOnlyHint) ...<Widget>[
            Text(
              StringLookup.t(loc, 'pickUseBoxScan'),
              style: TextStyle(fontSize: 12, color: Colors.orange.shade800),
            ),
            const SizedBox(height: 8),
          ],
          if (productBarcode != null && onScanProduct != null) ...<Widget>[
            _barcodeScanRow(
              controller: productBarcode!,
              label: StringLookup.t(loc, 'pickHybridScanProduct'),
              onScan: onScanProduct,
              onSubmitted: onProductBarcodeSubmitted,
              onChanged: onProductBarcodeChanged,
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: looseQty,
            keyboardType: kStockQtyKeyboardType,
            inputFormatters: kStockQtyInputFormatters,
            decoration: InputDecoration(
              labelText: StringLookup.t(loc, 'qtyShort'),
              border: const OutlineInputBorder(),
              suffixIcon: buildInputClearButton(
                visible: looseQty.text.trim().isNotEmpty,
                onPressed: () {
                  looseQty.clear();
                  onFieldsChanged();
                },
              ),
            ),
            onChanged: (_) => onFieldsChanged(),
          ),
          if (hybrid.valid && hybrid.total >= 1) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              StringLookup.tParams(
                loc,
                'kirimNewTotalUnits',
                <String, String>{'total': '${hybrid.total}'},
              ),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ],
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (showBoxOnlyHint) ...<Widget>[
          Text(
            StringLookup.t(loc, 'pickUseBoxScan'),
            style: TextStyle(fontSize: 12, color: Colors.orange.shade800),
          ),
          const SizedBox(height: 8),
        ],
        InputDecorator(
          decoration: InputDecoration(
            labelText: StringLookup.t(loc, 'kirimNewUnitsPerBox'),
            border: const OutlineInputBorder(),
          ),
          child: Text('$upb'),
        ),
        const SizedBox(height: 12),
        if (showHybridScans) ...<Widget>[
          _barcodeScanRow(
            controller: boxBarcode!,
            label: StringLookup.t(loc, 'pickHybridScanBox'),
            onScan: onScanBox,
            onSubmitted: onBoxBarcodeSubmitted,
            onChanged: onBoxBarcodeChanged,
          ),
          const SizedBox(height: 12),
        ],
        TextField(
          controller: boxCount,
          enabled: canEditBoxCount && !busy,
          keyboardType: kStockQtyKeyboardType,
          inputFormatters: kStockQtyInputFormatters,
          decoration: InputDecoration(
            labelText: StringLookup.t(loc, 'kirimNewBoxCount'),
            border: const OutlineInputBorder(),
            suffixIcon: buildInputClearButton(
              visible: canEditBoxCount &&
                  boxCount.text.trim().isNotEmpty &&
                  boxCount.text.trim() != '0',
              onPressed: () {
                boxCount.text = '0';
                onFieldsChanged();
              },
            ),
          ),
          onChanged: (_) {
            syncHybridBoxBarcodeWithQty(
              boxCount: boxCount,
              boxBarcode: boxBarcode,
            );
            onFieldsChanged();
          },
        ),
        const SizedBox(height: 16),
        if (showHybridScans) ...<Widget>[
          _barcodeScanRow(
            controller: productBarcode!,
            label: StringLookup.t(loc, 'pickHybridScanProduct'),
            onScan: onScanProduct,
            onSubmitted: onProductBarcodeSubmitted,
            onChanged: onProductBarcodeChanged,
          ),
          const SizedBox(height: 12),
        ],
        TextField(
          controller: looseQty,
          enabled: !busy,
          keyboardType: kStockQtyKeyboardType,
          inputFormatters: kStockQtyInputFormatters,
          decoration: InputDecoration(
            labelText: StringLookup.t(loc, 'pickHybridExtraLoose'),
            border: const OutlineInputBorder(),
            suffixIcon: buildInputClearButton(
              visible: looseQty.text.trim().isNotEmpty && looseQty.text.trim() != '0',
              onPressed: () {
                looseQty.text = '0';
                onFieldsChanged();
              },
            ),
          ),
          onChanged: (_) => onFieldsChanged(),
        ),
        if (hybrid.valid && hybrid.total >= 1) ...<Widget>[
          const SizedBox(height: 12),
          Text(
            StringLookup.tParams(
              loc,
              'kirimNewTotalUnits',
              <String, String>{'total': '${hybrid.total}'},
            ),
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ],
      ],
    );
  }
}
