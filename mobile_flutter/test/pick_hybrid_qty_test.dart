import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/shared/widgets/pick_box_qty_fields.dart';

void main() {
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
