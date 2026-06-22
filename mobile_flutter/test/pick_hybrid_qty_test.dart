import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/core/app_state/app_locale.dart';
import 'package:mobile_flutter/features/picking/data/picking_models.dart';
import 'package:mobile_flutter/shared/widgets/pick_box_qty_fields.dart';

PickingAlternateLocation _alt({
  required String locationCode,
  required bool isPrimary,
  int? looseUnits,
  int? boxCount,
  int unitsInBoxes = 0,
}) {
  return PickingAlternateLocation(
    locationId: 'loc-$locationCode',
    locationCode: locationCode,
    lotId: 'lot-1',
    availableQty: 10,
    batch: null,
    expiryDate: null,
    isPrimary: isPrimary,
    boxCount: boxCount,
    unitsInBoxes: unitsInBoxes,
    looseUnits: looseUnits,
  );
}

void main() {
  test('capHybridQtyToMax reduces loose before boxes', () {
    final TextEditingController boxCount = TextEditingController(text: '1');
    final TextEditingController looseQty = TextEditingController(text: '2');
    capHybridQtyToMax(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 6,
      maxUnits: 8,
    );
    expect(boxCount.text, '1');
    expect(looseQty.text, '2');
    expect(
      computePickHybridQty(
        boxCount: 1,
        looseQty: 2,
        unitsPerBox: 6,
        maxUnits: 8,
      ).total,
      8,
    );
  });

  test('capHybridQtyToMax keeps controllers when partial box fits within max', () {
    final TextEditingController boxCount = TextEditingController(text: '2');
    final TextEditingController looseQty = TextEditingController(text: '5');
    capHybridQtyToMax(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 6,
      maxUnits: 10,
    );
    expect(boxCount.text, '2');
    expect(looseQty.text, '5');
    expect(
      computePickHybridQty(
        boxCount: 2,
        looseQty: 5,
        unitsPerBox: 6,
        maxUnits: 10,
      ).total,
      10,
    );
  });

  test('capHybridQtyToMax loose only within max unchanged', () {
    final TextEditingController boxCount = TextEditingController(text: '0');
    final TextEditingController looseQty = TextEditingController(text: '4');
    capHybridQtyToMax(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 12,
      maxUnits: 4,
    );
    expect(boxCount.text, '0');
    expect(looseQty.text, '4');
  });

  test('computePickHybridQty caps at maxUnits', () {
    final PickHybridQty hybrid = computePickHybridQty(
      boxCount: 5,
      looseQty: 6,
      unitsPerBox: 6,
      maxUnits: 20,
    );
    expect(hybrid.total, 20);
    expect(hybrid.boxUnits, 20);
    expect(hybrid.looseUnits, 0);
    expect(hybrid.valid, isTrue);
  });

  test('computePickHybridQty invalid without upb when boxes positive', () {
    final PickHybridQty hybrid = computePickHybridQty(
      boxCount: 2,
      looseQty: 3,
      unitsPerBox: null,
      maxUnits: 14,
    );
    expect(hybrid.valid, isFalse);
  });

  test('computePickHybridQty loose only', () {
    final PickHybridQty hybrid = computePickHybridQty(
      boxCount: 0,
      looseQty: 4,
      unitsPerBox: 6,
      maxUnits: 10,
    );
    expect(hybrid.total, 4);
    expect(hybrid.boxCount, 0);
    expect(hybrid.looseUnits, 4);
    expect(hybrid.valid, isTrue);
  });

  test('capHybridQtyToMax keeps box count for partial pick within max', () {
    final TextEditingController boxCount = TextEditingController(text: '1');
    final TextEditingController looseQty = TextEditingController(text: '0');
    capHybridQtyToMax(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 12,
      maxUnits: 1,
    );
    expect(boxCount.text, '1');
    expect(looseQty.text, '0');
  });

  test('syncHybridBoxBarcodeWithQty keeps barcode for open-box loose pick', () {
    final TextEditingController boxCount = TextEditingController(text: '0');
    final TextEditingController looseQty = TextEditingController(text: '1');
    final TextEditingController boxBarcode = TextEditingController(text: 'BOX-1');
    syncHybridBoxBarcodeWithQty(
      boxCount: boxCount,
      boxBarcode: boxBarcode,
      looseQty: looseQty,
    );
    expect(boxBarcode.text, 'BOX-1');
  });

  test('syncHybridBoxBarcodeWithQty clears barcode when box count is zero', () {
    final TextEditingController boxCount = TextEditingController(text: '0');
    final TextEditingController boxBarcode = TextEditingController(text: 'BOX-1');
    syncHybridBoxBarcodeWithQty(boxCount: boxCount, boxBarcode: boxBarcode);
    expect(boxBarcode.text, isEmpty);
  });

  test('alternateBoxHintForLocation matches location code', () {
    final List<PickingAlternateLocation> alts = <PickingAlternateLocation>[
      _alt(
        locationCode: 'A-01',
        isPrimary: true,
        looseUnits: 0,
        boxCount: 2,
        unitsInBoxes: 24,
      ),
      _alt(
        locationCode: 'B-02',
        isPrimary: false,
        looseUnits: 5,
        boxCount: 0,
      ),
    ];
    final ({int? looseUnits, int? boxCount}) hint =
        alternateBoxHintForLocation(alts, 'B-02');
    expect(hint.looseUnits, 5);
    expect(hint.boxCount, 0);
  });

  test('hybridShowUnitsPerBoxField hidden until box scan or box count', () {
    final TextEditingController boxCount = TextEditingController(text: '0');
    final TextEditingController boxBarcode = TextEditingController();
    expect(
      hybridShowUnitsPerBoxField(boxBarcode: boxBarcode, boxCount: boxCount),
      isFalse,
    );
    boxBarcode.text = 'BOX-99';
    expect(
      hybridShowUnitsPerBoxField(boxBarcode: boxBarcode, boxCount: boxCount),
      isTrue,
    );
    boxBarcode.clear();
    boxCount.text = '2';
    expect(
      hybridShowUnitsPerBoxField(boxBarcode: boxBarcode, boxCount: boxCount),
      isTrue,
    );
  });

  test('hybridPickStockHintMessage shows open box plan for partial pick', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 10,
      boxUnits: 8,
      looseUnits: 2,
      boxCount: 1,
      valid: true,
    );
    final String? hint = hybridPickStockHintMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      stockLooseUnits: 0,
      stockBoxCount: 10,
    );
    expect(hint, isNotNull);
    expect(hint, contains('1'));
    expect(hint, contains('2'));
  });
}
