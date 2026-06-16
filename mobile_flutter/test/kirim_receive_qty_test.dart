import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/kirim/presentation/kirim_receive_qty.dart';

void main() {
  test('computeKirimReceiveTotal loose only', () {
    expect(
      computeKirimReceiveTotal(boxCount: 0, looseQty: 24, unitsPerBox: null),
      24,
    );
  });

  test('computeKirimReceiveTotal hybrid', () {
    expect(
      computeKirimReceiveTotal(boxCount: 5, looseQty: 6, unitsPerBox: 6),
      36,
    );
  });

  test('computeKirimReceiveTotal boxes only', () {
    expect(
      computeKirimReceiveTotal(boxCount: 8, looseQty: 0, unitsPerBox: 10),
      80,
    );
  });

  test('computeKirimReceiveTotal needs upb when boxes positive', () {
    expect(
      computeKirimReceiveTotal(boxCount: 2, looseQty: 3, unitsPerBox: null),
      isNull,
    );
  });
}
