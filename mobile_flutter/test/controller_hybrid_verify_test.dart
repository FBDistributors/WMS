import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/core/app_state/app_locale.dart';
import 'package:mobile_flutter/l10n/string_lookup.dart';
import 'package:mobile_flutter/shared/widgets/pick_box_qty_fields.dart';
import 'package:mobile_flutter/shared/widgets/pick_hybrid_submit.dart';

void main() {
  test('controllerHybridVerifyValidationMessage qty mismatch', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 25,
      boxUnits: 20,
      looseUnits: 5,
      boxCount: 1,
      valid: true,
    );
    final String? msg = controllerHybridVerifyValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      aggPicked: 30,
      boxBarcode: 'BOX-1',
      productBarcode: 'UNIT-1',
      primaryLooseUnits: 5,
      primaryBoxCount: 2,
    );
    expect(msg, isNotNull);
    expect(msg, StringLookup.t(AppLocale.uz, 'qtyMismatch'));
  });

  test('controllerHybridVerifyValidationMessage valid hybrid', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 30,
      boxUnits: 20,
      looseUnits: 10,
      boxCount: 1,
      valid: true,
    );
    final String? msg = controllerHybridVerifyValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      aggPicked: 30,
      boxBarcode: 'BOX-1',
      productBarcode: 'UNIT-1',
      primaryLooseUnits: 10,
      primaryBoxCount: 2,
    );
    expect(msg, isNull);
  });

  test('controllerHybridVerifyValidationMessage blocks loose without product scan', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 30,
      boxUnits: 0,
      looseUnits: 30,
      boxCount: 0,
      valid: true,
    );
    final String? msg = controllerHybridVerifyValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      aggPicked: 30,
      boxBarcode: null,
      productBarcode: null,
      primaryLooseUnits: 249,
      primaryBoxCount: 0,
    );
    expect(msg, isNotNull);
    expect(msg, StringLookup.t(AppLocale.uz, 'pickHybridScanProductFirst'));
  });

  test('applyHybridQtyDefaults controller loose-only aggPicked=30', () {
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
}
