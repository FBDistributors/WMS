import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state/app_locale.dart';
import '../../core/router/scanner_args.dart';
import '../../features/product_boxes/data/product_box_models.dart';
import '../../features/product_boxes/data/product_box_repository.dart';
import '../../features/scanner/data/scanner_repository.dart';
import '../../l10n/string_lookup.dart';
import 'pick_box_qty_fields.dart';
import 'scan_action_button.dart';

/// Birinchi (quti) chaqiruv muvaffaqiyatli, ikkinchisi xato (eski server fallback).
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

typedef HybridCombinedPickFn = Future<void> Function({
  required int totalQty,
  required int boxCount,
  required String productBarcode,
  required String boxBarcode,
});

class HybridBoxScanResult {
  const HybridBoxScanResult({
    required this.barcode,
    this.unitsPerBox,
  });

  final String barcode;
  final int? unitsPerBox;
}

Future<HybridBoxScanResult> resolveHybridBoxBarcode(
  ScannerRepository scanner,
  String raw,
) async {
  final String trimmed = raw.trim();
  if (trimmed.isEmpty) {
    return const HybridBoxScanResult(barcode: '');
  }
  try {
    final ScannerResolveOut out = await scanner.resolveBarcode(trimmed);
    if (out.isBoxScan && out.unitsPerScan != null && out.unitsPerScan! >= 1) {
      return HybridBoxScanResult(
        barcode: trimmed,
        unitsPerBox: out.unitsPerScan,
      );
    }
  } on Object {
    // Qo'lda kiritilgan kod — faqat matn sifatida saqlanadi.
  }
  return HybridBoxScanResult(barcode: trimmed);
}

/// Mahsulot skan: agar kod quti kodi bo'lsa unitsPerBox qaytariladi.
Future<HybridBoxScanResult> resolveHybridProductBarcode(
  ScannerRepository scanner,
  String raw,
) async {
  final String trimmed = raw.trim();
  if (trimmed.isEmpty) {
    return const HybridBoxScanResult(barcode: '');
  }
  try {
    final ScannerResolveOut out = await scanner.resolveBarcode(trimmed);
    if (out.isBoxScan && out.unitsPerScan != null && out.unitsPerScan! >= 1) {
      return HybridBoxScanResult(
        barcode: trimmed,
        unitsPerBox: out.unitsPerScan,
      );
    }
  } on Object {
    // Qo'lda kiritilgan kod — faqat matn sifatida saqlanadi.
  }
  return HybridBoxScanResult(barcode: trimmed);
}

/// Mahsulot uchun ro'yxatdan o'tgan quti (dona barcode dan farq qilishi mumkin).
Future<({int? unitsPerBox, String? boxBarcode})> loadHybridProductBoxHint(
  ProductBoxRepository repo,
  String? productId,
) async {
  final String id = productId?.trim() ?? '';
  if (id.isEmpty) {
    return (unitsPerBox: null, boxBarcode: null);
  }
  try {
    final List<ProductBoxSummary> boxes = await repo.listByProduct(id);
    if (boxes.isEmpty) {
      return (unitsPerBox: null, boxBarcode: null);
    }
    final ProductBoxSummary first = boxes.first;
    return (unitsPerBox: first.unitsPerBox, boxBarcode: first.boxBarcode);
  } on Object {
    return (unitsPerBox: null, boxBarcode: null);
  }
}

String? hybridBoxOnlyStockValidationMessage({
  required AppLocale loc,
  required PickHybridQty hybrid,
  int? primaryLooseUnits,
  int? primaryBoxCount,
}) {
  if (hybrid.boxCount > 0 || hybrid.looseUnits < 1) {
    return null;
  }
  final int loose = primaryLooseUnits ?? 0;
  if (loose < 1 && (primaryBoxCount ?? 0) > 0) {
    return StringLookup.t(loc, 'pickUseBoxScan');
  }
  return null;
}

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

String? controllerHybridVerifyValidationMessage({
  required AppLocale loc,
  required PickHybridQty hybrid,
  required double aggPicked,
  required String? boxBarcode,
  required String? productBarcode,
  int? primaryLooseUnits,
  int? primaryBoxCount,
}) {
  final String? boxOnly = hybridBoxOnlyStockValidationMessage(
    loc: loc,
    hybrid: hybrid,
    primaryLooseUnits: primaryLooseUnits,
    primaryBoxCount: primaryBoxCount,
  );
  if (boxOnly != null) {
    return boxOnly;
  }
  final String? hybridValidation = hybridPickValidationMessage(
    loc: loc,
    hybrid: hybrid,
    boxBarcode: boxBarcode,
    productBarcode: productBarcode,
    maxUnits: aggPicked,
  );
  if (hybridValidation != null) {
    return hybridValidation;
  }
  if (hybrid.total != aggPicked.round()) {
    return StringLookup.t(loc, 'qtyMismatch');
  }
  return null;
}

Future<void> submitHybridPick({
  required PickHybridQty hybrid,
  required String? boxBarcode,
  required String? productBarcode,
  required HybridBoxPickFn pickBox,
  required HybridUnitPickFn pickUnit,
  HybridCombinedPickFn? pickCombined,
}) async {
  if (hybrid.boxCount > 0 && hybrid.looseUnits > 0) {
    final HybridCombinedPickFn combined = pickCombined ??
        (({
          required int totalQty,
          required int boxCount,
          required String productBarcode,
          required String boxBarcode,
        }) async {
          int boxUnitsPicked = 0;
          await pickBox(
            qty: hybrid.boxUnits,
            boxCount: boxCount,
            barcode: boxBarcode,
          );
          boxUnitsPicked = hybrid.boxUnits;
          try {
            await pickUnit(qty: hybrid.looseUnits, barcode: productBarcode);
          } on Object catch (e) {
            if (boxUnitsPicked > 0) {
              throw HybridPickPartialFailure(boxUnitsPicked: boxUnitsPicked, cause: e);
            }
            rethrow;
          }
        });
    await combined(
      totalQty: hybrid.total,
      boxCount: hybrid.boxCount,
      productBarcode: productBarcode!.trim(),
      boxBarcode: boxBarcode!.trim(),
    );
    return;
  }
  if (hybrid.boxCount > 0) {
    await pickBox(
      qty: hybrid.boxUnits,
      boxCount: hybrid.boxCount,
      barcode: boxBarcode!.trim(),
    );
    return;
  }
  if (hybrid.looseUnits > 0) {
    await pickUnit(qty: hybrid.looseUnits, barcode: productBarcode!.trim());
  }
}

typedef HybridScanApplyResult = ({int? unitsPerBox, bool routedToBox});

Future<HybridScanApplyResult> applyHybridBoxScan({
  required ScannerRepository scanner,
  required String raw,
  required TextEditingController boxCount,
  required TextEditingController looseQty,
  required TextEditingController boxBarcode,
  required int? unitsPerBox,
  required double maxUnits,
  bool bumpCount = true,
}) async {
  final HybridBoxScanResult result = await resolveHybridBoxBarcode(scanner, raw);
  final int? newUpb = result.unitsPerBox ?? unitsPerBox;
  boxBarcode.text = result.barcode;
  if (bumpCount && result.barcode.isNotEmpty) {
    final int bc = int.tryParse(boxCount.text.trim()) ?? 0;
    boxCount.text = '${bc + 1}';
    capHybridQtyToMax(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: newUpb,
      maxUnits: maxUnits,
    );
  }
  return (unitsPerBox: newUpb, routedToBox: true);
}

Future<HybridScanApplyResult> applyHybridProductScan({
  required ScannerRepository scanner,
  required String raw,
  required TextEditingController boxCount,
  required TextEditingController looseQty,
  required TextEditingController boxBarcode,
  required TextEditingController productBarcode,
  required int? unitsPerBox,
  required double maxUnits,
  bool bumpCount = true,
}) async {
  final HybridBoxScanResult result = await resolveHybridProductBarcode(scanner, raw);
  if (result.unitsPerBox != null) {
    return applyHybridBoxScan(
      scanner: scanner,
      raw: raw,
      boxCount: boxCount,
      looseQty: looseQty,
      boxBarcode: boxBarcode,
      unitsPerBox: result.unitsPerBox ?? unitsPerBox,
      maxUnits: maxUnits,
      bumpCount: bumpCount,
    );
  }
  productBarcode.text = result.barcode;
  if (bumpCount && result.barcode.isNotEmpty) {
    final int lq = int.tryParse(looseQty.text.trim()) ?? 0;
    looseQty.text = '${lq + 1}';
    capHybridQtyToMax(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: unitsPerBox,
      maxUnits: maxUnits,
    );
  }
  return (unitsPerBox: unitsPerBox, routedToBox: false);
}

Future<String?> launchHybridRawBarcodeScan(BuildContext context) async {
  final String? code = await context.pushNamed<String>(
    'scanner',
    extra: const ScannerArgs(returnRawBarcode: true),
  );
  final String trimmed = code?.trim() ?? '';
  return trimmed.isEmpty ? null : trimmed;
}

/// @deprecated Use [PickHybridQtyFields] with integrated scan rows.
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
    this.onBoxBarcodeSubmitted,
    this.onProductBarcodeSubmitted,
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
  final Future<void> Function(String code)? onBoxBarcodeSubmitted;
  final Future<void> Function(String code)? onProductBarcodeSubmitted;
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
                onSubmitted: (String v) {
                  final Future<void> Function(String code)? handler = onBoxBarcodeSubmitted;
                  if (handler != null) {
                    unawaited(handler(v));
                  }
                },
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
                onSubmitted: (String v) {
                  final Future<void> Function(String code)? handler =
                      onProductBarcodeSubmitted;
                  if (handler != null) {
                    unawaited(handler(v));
                  }
                },
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
