import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/shared/widgets/pick_box_qty_fields.dart';

void main() {
  test('isLooseOnlyLocation faqat qutisiz dona', () {
    expect(
      isLooseOnlyLocation(stockBoxCount: 0, stockLooseUnits: 249),
      isTrue,
    );
    expect(
      isLooseOnlyLocation(stockBoxCount: 11, stockLooseUnits: 2),
      isFalse,
    );
    expect(
      isLooseOnlyLocation(stockBoxCount: 0, stockLooseUnits: 0),
      isFalse,
    );
  });

  test('computeLocationAwareHybridDefaults controller verify loose-only uses full picked qty', () {
    final ({int boxCount, int looseQty}) defaults =
        computeLocationAwareHybridDefaults(
      maxPick: 44,
      unitsPerBox: 8,
      stockBoxCount: 0,
      stockLooseUnits: 5,
      forControllerVerify: true,
    );
    expect(defaults.boxCount, 0);
    expect(defaults.looseQty, 44);
  });

  test('computeLocationAwareHybridDefaults loose-only 30 dona', () {
    final ({int boxCount, int looseQty}) defaults =
        computeLocationAwareHybridDefaults(
      maxPick: 30,
      unitsPerBox: 20,
      stockBoxCount: 0,
      stockLooseUnits: 249,
    );
    expect(defaults.boxCount, 0);
    expect(defaults.looseQty, 30);
  });

  test('computeLocationAwareHybridDefaults box-only 10 dona 8/quti', () {
    final ({int boxCount, int looseQty}) defaults =
        computeLocationAwareHybridDefaults(
      maxPick: 10,
      unitsPerBox: 8,
      stockBoxCount: 5,
      stockLooseUnits: 0,
    );
    expect(defaults.boxCount, 1);
    expect(defaults.looseQty, 2);
  });

  test('computeLocationAwareHybridDefaults mixed ochiq dona yetadi', () {
    final ({int boxCount, int looseQty}) defaults =
        computeLocationAwareHybridDefaults(
      maxPick: 10,
      unitsPerBox: 8,
      stockBoxCount: 5,
      stockLooseUnits: 5,
    );
    expect(defaults.boxCount, 1);
    expect(defaults.looseQty, 2);
  });

  test('applyHybridQtyDefaults loose-only kontrollerlarni to\'ldiradi', () {
    final TextEditingController boxCount = TextEditingController();
    final TextEditingController looseQty = TextEditingController();
    applyHybridQtyDefaults(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 20,
      maxUnits: 30,
      stockBoxCount: 0,
      stockLooseUnits: 249,
    );
    expect(boxCount.text, '0');
    expect(looseQty.text, '30');
    boxCount.dispose();
    looseQty.dispose();
  });

  test('applyHybridQtyDefaults breakdown noma\'lum — faqat qutisiz default', () {
    final TextEditingController boxCount = TextEditingController();
    final TextEditingController looseQty = TextEditingController();
    applyHybridQtyDefaults(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 20,
      maxUnits: 30,
    );
    expect(boxCount.text, '0');
    expect(looseQty.text, '30');
    boxCount.dispose();
    looseQty.dispose();
  });
}
