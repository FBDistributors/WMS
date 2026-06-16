import 'dart:math' show max, min;

import 'package:flutter/material.dart';

import '../../core/app_state/app_locale.dart';
import '../../features/picking/data/picking_models.dart';
import '../../l10n/string_lookup.dart';
import '../input/input_clear_button.dart';
import '../input/stock_quantity_input.dart';

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

/// Terish: quti soni + qo'shimcha dona (SegmentedButton yo'q).
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
  });

  final AppLocale loc;
  final TextEditingController boxCount;
  final TextEditingController looseQty;
  final int? unitsPerBox;
  final double maxUnits;
  final VoidCallback onFieldsChanged;
  final int? looseUnits;

  @override
  Widget build(BuildContext context) {
    final int? upb = unitsPerBox;
    final PickHybridQty hybrid = pickHybridQtyFromControllers(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: upb,
      maxUnits: maxUnits,
    );

    if (upb == null || upb < 1) {
      return TextField(
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
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        InputDecorator(
          decoration: InputDecoration(
            labelText: StringLookup.t(loc, 'kirimNewUnitsPerBox'),
            border: const OutlineInputBorder(),
          ),
          child: Text('$upb'),
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
              visible: boxCount.text.trim().isNotEmpty && boxCount.text.trim() != '0',
              onPressed: () {
                boxCount.text = '0';
                onFieldsChanged();
              },
            ),
          ),
          onChanged: (_) => onFieldsChanged(),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: looseQty,
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
        if (hybrid.valid) ...<Widget>[
          const SizedBox(height: 12),
          Text(
            StringLookup.tParams(
              loc,
              'pickHybridTotal',
              <String, String>{
                'boxes': '${hybrid.boxCount}',
                'upb': '$upb',
                'loose': '${hybrid.looseUnits}',
                'total': '${hybrid.total}',
              },
            ),
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ],
      ],
    );
  }
}
