import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/shared/widgets/pick_box_qty_fields.dart';
import 'package:mobile_flutter/shared/widgets/pick_hybrid_submit.dart';

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

  test('capHybridQtyToMax trims overflow from loose then boxes', () {
    final TextEditingController boxCount = TextEditingController(text: '2');
    final TextEditingController looseQty = TextEditingController(text: '5');
    capHybridQtyToMax(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 6,
      maxUnits: 10,
    );
    expect(boxCount.text, '1');
    expect(looseQty.text, '0');
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
}
