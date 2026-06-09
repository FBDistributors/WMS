import 'dart:math' show max, min;

import 'package:flutter/material.dart';

import '../../core/app_state/app_locale.dart';
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
