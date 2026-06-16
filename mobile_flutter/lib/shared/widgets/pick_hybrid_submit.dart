import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state/app_locale.dart';
import '../../core/router/scanner_args.dart';
import '../../l10n/string_lookup.dart';
import 'pick_box_qty_fields.dart';
import 'scan_action_button.dart';

/// Birinchi (quti) chaqiruv muvaffaqiyatli, ikkinchisi xato.
class HybridPickPartialFailure implements Exception {
  HybridPickPartialFailure({
    required this.boxUnitsPicked,
    required this.cause,
  });

  final int boxUnitsPicked;
  final Object cause;

  @override
  String toString() => '$cause';
}

typedef HybridBoxPickFn = Future<void> Function({
  required int qty,
  required int boxCount,
  required String barcode,
});

typedef HybridUnitPickFn = Future<void> Function({
  required int qty,
  required String barcode,
});

String? hybridPickValidationMessage({
  required AppLocale loc,
  required PickHybridQty hybrid,
  required String? boxBarcode,
  required String? productBarcode,
  required double maxUnits,
}) {
  final int maxPick = maxUnits.round();
  if (!hybrid.valid || hybrid.total < 1 || hybrid.total > maxPick) {
    return StringLookup.tParams(
      loc,
      'qtyRangeError',
      <String, String>{'max': '$maxPick'},
    );
  }
  if (hybrid.boxCount > 0 && (boxBarcode == null || boxBarcode.trim().isEmpty)) {
    return StringLookup.t(loc, 'pickHybridScanBoxFirst');
  }
  if (hybrid.looseUnits > 0 &&
      (productBarcode == null || productBarcode.trim().isEmpty)) {
    return StringLookup.t(loc, 'pickHybridScanProductFirst');
  }
  return null;
}

Future<void> submitHybridPick({
  required PickHybridQty hybrid,
  required String? boxBarcode,
  required String? productBarcode,
  required HybridBoxPickFn pickBox,
  required HybridUnitPickFn pickUnit,
}) async {
  int boxUnitsPicked = 0;
  if (hybrid.boxCount > 0) {
    final String bc = boxBarcode!.trim();
    await pickBox(
      qty: hybrid.boxUnits,
      boxCount: hybrid.boxCount,
      barcode: bc,
    );
    boxUnitsPicked = hybrid.boxUnits;
  }
  if (hybrid.looseUnits > 0) {
    final String pc = productBarcode!.trim();
    try {
      await pickUnit(qty: hybrid.looseUnits, barcode: pc);
    } on Object catch (e) {
      if (boxUnitsPicked > 0) {
        throw HybridPickPartialFailure(boxUnitsPicked: boxUnitsPicked, cause: e);
      }
      rethrow;
    }
  }
}

Future<String?> launchHybridRawBarcodeScan(BuildContext context) async {
  final String? code = await context.pushNamed<String>(
    'scanner',
    extra: const ScannerArgs(returnRawBarcode: true),
  );
  final String trimmed = code?.trim() ?? '';
  return trimmed.isEmpty ? null : trimmed;
}

class PickHybridScanFields extends StatelessWidget {
  const PickHybridScanFields({
    super.key,
    required this.loc,
    required this.hybrid,
    required this.boxBarcode,
    required this.productBarcode,
    required this.onBoxBarcodeChanged,
    required this.onProductBarcodeChanged,
    required this.onScanBox,
    required this.onScanProduct,
    this.busy = false,
  });

  final AppLocale loc;
  final PickHybridQty hybrid;
  final TextEditingController boxBarcode;
  final TextEditingController productBarcode;
  final VoidCallback onBoxBarcodeChanged;
  final VoidCallback onProductBarcodeChanged;
  final VoidCallback onScanBox;
  final VoidCallback onScanProduct;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final List<Widget> children = <Widget>[];
    if (hybrid.boxCount > 0) {
      children.addAll(<Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: <Widget>[
            Expanded(
              child: TextField(
                controller: boxBarcode,
                enabled: !busy,
                decoration: InputDecoration(
                  labelText: StringLookup.t(loc, 'pickHybridScanBox'),
                  border: const OutlineInputBorder(),
                ),
                onChanged: (_) => onBoxBarcodeChanged(),
              ),
            ),
            const SizedBox(width: 8),
            ScanActionButton(
              onPressed: busy ? null : onScanBox,
              label: StringLookup.t(loc, 'pickHybridScanBox'),
              compact: true,
            ),
          ],
        ),
        const SizedBox(height: 12),
      ]);
    }
    if (hybrid.looseUnits > 0) {
      children.addAll(<Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: <Widget>[
            Expanded(
              child: TextField(
                controller: productBarcode,
                enabled: !busy,
                decoration: InputDecoration(
                  labelText: StringLookup.t(loc, 'pickHybridScanProduct'),
                  border: const OutlineInputBorder(),
                ),
                onChanged: (_) => onProductBarcodeChanged(),
              ),
            ),
            const SizedBox(width: 8),
            ScanActionButton(
              onPressed: busy ? null : onScanProduct,
              label: StringLookup.t(loc, 'pickHybridScanProduct'),
              compact: true,
            ),
          ],
        ),
      ]);
    }
    if (children.isEmpty) {
      return const SizedBox.shrink();
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );
  }
}
