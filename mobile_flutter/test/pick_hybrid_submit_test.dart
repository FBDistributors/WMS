import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/core/app_state/app_locale.dart';
import 'package:mobile_flutter/features/scanner/data/scanner_repository.dart';
import 'package:mobile_flutter/l10n/string_lookup.dart';
import 'package:mobile_flutter/shared/widgets/pick_box_qty_fields.dart';
import 'package:mobile_flutter/shared/widgets/pick_hybrid_submit.dart';

void main() {
  test('submitHybridPick uses combined pick for box and loose', () async {
    final PickHybridQty hybrid = computePickHybridQty(
      boxCount: 2,
      looseQty: 2,
      unitsPerBox: 6,
      maxUnits: 14,
    );
    int? combinedTotal;
    int? combinedBoxCount;
    String? combinedProduct;
    String? combinedBox;
    int boxCalls = 0;
    int unitCalls = 0;

    await submitHybridPick(
      hybrid: hybrid,
      boxBarcode: 'BOX-1',
      productBarcode: 'PROD-1',
      pickBox: ({
        required int qty,
        required int boxCount,
        required String barcode,
      }) async {
        boxCalls++;
      },
      pickUnit: ({required int qty, required String barcode}) async {
        unitCalls++;
      },
      pickCombined: ({
        required int totalQty,
        required int boxCount,
        required String productBarcode,
        required String boxBarcode,
      }) async {
        combinedTotal = totalQty;
        combinedBoxCount = boxCount;
        combinedProduct = productBarcode;
        combinedBox = boxBarcode;
      },
    );

    expect(combinedTotal, 14);
    expect(combinedBoxCount, 2);
    expect(combinedProduct, 'PROD-1');
    expect(combinedBox, 'BOX-1');
    expect(boxCalls, 0);
    expect(unitCalls, 0);
  });

  test('submitHybridPick box only calls pickBox', () async {
    final PickHybridQty hybrid = computePickHybridQty(
      boxCount: 3,
      looseQty: 0,
      unitsPerBox: 6,
      maxUnits: 18,
    );
    int? boxQty;
    await submitHybridPick(
      hybrid: hybrid,
      boxBarcode: 'BOX-2',
      productBarcode: 'PROD-2',
      pickBox: ({
        required int qty,
        required int boxCount,
        required String barcode,
      }) async {
        boxQty = qty;
      },
      pickUnit: ({required int qty, required String barcode}) async {},
    );
    expect(boxQty, 18);
  });

  test('applyHybridBoxScan bumps box count and fills barcode', () async {
    final TextEditingController boxCount = TextEditingController(text: '0');
    final TextEditingController looseQty = TextEditingController(text: '0');
    final TextEditingController boxBarcode = TextEditingController();
    final _RecordingScanner scanner = _RecordingScanner(
      onResolve: (String raw) async => ScannerResolveOut(
        type: ScannerResolveType.product,
        productId: 'p1',
        productName: 'P',
        productBarcode: raw,
        locationId: null,
        locationCode: null,
        entityId: null,
        displayLabel: null,
        message: null,
        scanKind: 'box',
        unitsPerScan: 12,
      ),
    );
    final HybridScanApplyResult result = await applyHybridBoxScan(
      scanner: scanner,
      raw: 'BOX-99',
      boxCount: boxCount,
      looseQty: looseQty,
      boxBarcode: boxBarcode,
      unitsPerBox: 12,
      maxUnits: 20,
    );
    expect(result.routedToBox, isTrue);
    expect(result.unitsPerBox, 12);
    expect(boxBarcode.text, 'BOX-99');
    expect(boxCount.text, '1');
  });

  test('applyHybridProductScan routes box barcode to box bump', () async {
    final TextEditingController boxCount = TextEditingController(text: '0');
    final TextEditingController looseQty = TextEditingController(text: '2');
    final TextEditingController boxBarcode = TextEditingController();
    final TextEditingController productBarcode = TextEditingController();
    final _RecordingScanner scanner = _RecordingScanner(
      onResolve: (String raw) async => ScannerResolveOut(
        type: ScannerResolveType.product,
        productId: 'p1',
        productName: 'P',
        productBarcode: raw,
        locationId: null,
        locationCode: null,
        entityId: null,
        displayLabel: null,
        message: null,
        scanKind: 'box',
        unitsPerScan: 12,
      ),
    );
    final HybridScanApplyResult result = await applyHybridProductScan(
      scanner: scanner,
      raw: 'BOX-SAME',
      boxCount: boxCount,
      looseQty: looseQty,
      boxBarcode: boxBarcode,
      productBarcode: productBarcode,
      unitsPerBox: 12,
      maxUnits: 20,
    );
    expect(result.routedToBox, isTrue);
    expect(boxBarcode.text, 'BOX-SAME');
    expect(boxCount.text, '1');
    expect(productBarcode.text, isEmpty);
  });

  test('applyHybridProductScan forceProduct keeps unit scan despite box resolve', () async {
    final TextEditingController boxCount = TextEditingController(text: '0');
    final TextEditingController looseQty = TextEditingController(text: '2');
    final TextEditingController boxBarcode = TextEditingController();
    final TextEditingController productBarcode = TextEditingController();
    final _RecordingScanner scanner = _RecordingScanner(
      onResolve: (String raw) async => ScannerResolveOut(
        type: ScannerResolveType.product,
        productId: 'p1',
        productName: 'P',
        productBarcode: raw,
        locationId: null,
        locationCode: null,
        entityId: null,
        displayLabel: null,
        message: null,
        scanKind: 'box',
        unitsPerScan: 12,
      ),
    );
    final HybridScanApplyResult result = await applyHybridProductScan(
      scanner: scanner,
      raw: '4780015571578',
      boxCount: boxCount,
      looseQty: looseQty,
      boxBarcode: boxBarcode,
      productBarcode: productBarcode,
      unitsPerBox: 12,
      maxUnits: 20,
      bumpCount: false,
      forceProduct: true,
    );
    expect(result.routedToBox, isFalse);
    expect(productBarcode.text, '4780015571578');
    expect(boxBarcode.text, isEmpty);
  });

  test('applyHybridProductScan bumps loose for unit barcode', () async {
    final TextEditingController boxCount = TextEditingController(text: '0');
    final TextEditingController looseQty = TextEditingController(text: '1');
    final TextEditingController boxBarcode = TextEditingController();
    final TextEditingController productBarcode = TextEditingController();
    final _RecordingScanner scanner = _RecordingScanner(
      onResolve: (String raw) async => ScannerResolveOut(
        type: ScannerResolveType.product,
        productId: 'p1',
        productName: 'P',
        productBarcode: raw,
        locationId: null,
        locationCode: null,
        entityId: null,
        displayLabel: null,
        message: null,
        scanKind: 'unit',
      ),
    );
    final HybridScanApplyResult result = await applyHybridProductScan(
      scanner: scanner,
      raw: 'UNIT-1',
      boxCount: boxCount,
      looseQty: looseQty,
      boxBarcode: boxBarcode,
      productBarcode: productBarcode,
      unitsPerBox: 12,
      maxUnits: 10,
    );
    expect(result.routedToBox, isFalse);
    expect(productBarcode.text, 'UNIT-1');
    expect(looseQty.text, '2');
  });

  test('applyHybridBoxScan does not bump when open-box only', () async {
    final TextEditingController boxCount = TextEditingController(text: '0');
    final TextEditingController looseQty = TextEditingController(text: '1');
    final TextEditingController boxBarcode = TextEditingController();
    final _RecordingScanner scanner = _RecordingScanner(
      onResolve: (String raw) async => ScannerResolveOut(
        type: ScannerResolveType.product,
        productId: 'p1',
        productName: 'P',
        productBarcode: raw,
        locationId: null,
        locationCode: null,
        entityId: null,
        displayLabel: null,
        message: null,
        scanKind: 'box',
        unitsPerScan: 12,
      ),
    );
    final HybridScanApplyResult result = await applyHybridBoxScan(
      scanner: scanner,
      raw: 'BOX-99',
      boxCount: boxCount,
      looseQty: looseQty,
      boxBarcode: boxBarcode,
      unitsPerBox: 12,
      maxUnits: 1,
      stockBoxCount: 5,
      stockLooseUnits: 0,
    );
    expect(result.routedToBox, isTrue);
    expect(boxBarcode.text, 'BOX-99');
    expect(boxCount.text, '0');
  });

  test('applyHybridProductScan does not exceed prefilled loose for open-box', () async {
    final TextEditingController boxCount = TextEditingController(text: '0');
    final TextEditingController looseQty = TextEditingController(text: '1');
    final TextEditingController boxBarcode = TextEditingController(text: 'BOX-1');
    final TextEditingController productBarcode = TextEditingController();
    final _RecordingScanner scanner = _RecordingScanner(
      onResolve: (String raw) async => ScannerResolveOut(
        type: ScannerResolveType.product,
        productId: 'p1',
        productName: 'P',
        productBarcode: raw,
        locationId: null,
        locationCode: null,
        entityId: null,
        displayLabel: null,
        message: null,
        scanKind: 'unit',
      ),
    );
    await applyHybridProductScan(
      scanner: scanner,
      raw: 'UNIT-1',
      boxCount: boxCount,
      looseQty: looseQty,
      boxBarcode: boxBarcode,
      productBarcode: productBarcode,
      unitsPerBox: 12,
      maxUnits: 1,
      stockBoxCount: 5,
      stockLooseUnits: 0,
    );
    expect(productBarcode.text, 'UNIT-1');
    expect(looseQty.text, '1');
  });

  test('applyHybridBoxScan does not exceed prefilled box count', () async {
    final TextEditingController boxCount = TextEditingController(text: '1');
    final TextEditingController looseQty = TextEditingController(text: '2');
    final TextEditingController boxBarcode = TextEditingController();
    final _RecordingScanner scanner = _RecordingScanner(
      onResolve: (String raw) async => ScannerResolveOut(
        type: ScannerResolveType.product,
        productId: 'p1',
        productName: 'P',
        productBarcode: raw,
        locationId: null,
        locationCode: null,
        entityId: null,
        displayLabel: null,
        message: null,
        scanKind: 'box',
        unitsPerScan: 8,
      ),
    );
    await applyHybridBoxScan(
      scanner: scanner,
      raw: 'BOX-99',
      boxCount: boxCount,
      looseQty: looseQty,
      boxBarcode: boxBarcode,
      unitsPerBox: 8,
      maxUnits: 10,
      stockBoxCount: 5,
      stockLooseUnits: 0,
    );
    expect(boxBarcode.text, 'BOX-99');
    expect(boxCount.text, '1');
    expect(looseQty.text, '2');
  });

  test('submitHybridPick open-box uses combined pick with boxesToOpen', () async {
    const PickHybridQty hybrid = PickHybridQty(
      total: 1,
      boxUnits: 0,
      looseUnits: 1,
      boxCount: 0,
      valid: true,
    );
    int? combinedBoxCount;
    await submitHybridPick(
      hybrid: hybrid,
      boxBarcode: 'BOX-OPEN',
      productBarcode: 'PROD-1',
      unitsPerBox: 12,
      stockBoxCount: 5,
      stockLooseUnits: 0,
      pickBox: ({
        required int qty,
        required int boxCount,
        required String barcode,
      }) async {},
      pickUnit: ({required int qty, required String barcode}) async {},
      pickCombined: ({
        required int totalQty,
        required int boxCount,
        required String productBarcode,
        required String boxBarcode,
      }) async {
        combinedBoxCount = boxCount;
      },
    );
    expect(combinedBoxCount, 1);
  });

  test('submitHybridPick loose-only location uses pickUnit not pickCombined', () async {
    const PickHybridQty hybrid = PickHybridQty(
      total: 3,
      boxUnits: 0,
      looseUnits: 3,
      boxCount: 0,
      valid: true,
    );
    int unitPickQty = 0;
    var combinedCalled = false;
    await submitHybridPick(
      hybrid: hybrid,
      boxBarcode: 'BOX-STALE',
      productBarcode: '3713760812451',
      stockBoxCount: 0,
      stockLooseUnits: 24,
      pickBox: ({
        required int qty,
        required int boxCount,
        required String barcode,
      }) async {},
      pickUnit: ({required int qty, required String barcode}) async {
        unitPickQty = qty;
        expect(barcode, '3713760812451');
      },
      pickCombined: ({
        required int totalQty,
        required int boxCount,
        required String productBarcode,
        required String boxBarcode,
      }) async {
        combinedCalled = true;
      },
    );
    expect(unitPickQty, 3);
    expect(combinedCalled, isFalse);
  });

  test('hybridBoxOnlyStockValidationMessage allows when box barcode scanned', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 1,
      boxUnits: 0,
      looseUnits: 1,
      boxCount: 0,
      valid: true,
    );
    final String? allowed = hybridBoxOnlyStockValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      primaryLooseUnits: 0,
      primaryBoxCount: 2,
      boxBarcode: 'BOX-1',
    );
    expect(allowed, isNull);
  });

  test('hybridBoxOnlyStockValidationMessage uses location loose stock', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 4,
      boxUnits: 0,
      looseUnits: 4,
      boxCount: 0,
      valid: true,
    );
    final String? blocked = hybridBoxOnlyStockValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      primaryLooseUnits: 0,
      primaryBoxCount: 2,
    );
    expect(blocked, StringLookup.t(AppLocale.uz, 'pickHybridScanBoxFirst'));
  });
}

class _RecordingScanner extends ScannerRepository {
  _RecordingScanner({required this.onResolve}) : super(Dio());

  final Future<ScannerResolveOut> Function(String raw) onResolve;

  @override
  Future<ScannerResolveOut> resolveBarcode(String barcode) => onResolve(barcode);
}
