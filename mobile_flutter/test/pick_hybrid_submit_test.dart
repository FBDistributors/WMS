import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/scanner/data/scanner_repository.dart';
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
}

class _RecordingScanner extends ScannerRepository {
  _RecordingScanner({required this.onResolve}) : super(Dio());

  final Future<ScannerResolveOut> Function(String raw) onResolve;

  @override
  Future<ScannerResolveOut> resolveBarcode(String barcode) => onResolve(barcode);
}
