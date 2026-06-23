import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/core/app_state/app_locale.dart';
import 'package:mobile_flutter/features/picking/data/picking_models.dart';
import 'package:mobile_flutter/l10n/string_lookup.dart';
import 'package:mobile_flutter/shared/widgets/pick_box_qty_fields.dart';
import 'package:mobile_flutter/shared/widgets/pick_hybrid_submit.dart';

PickingLine _verifyLine({
  String barcode = '4620018872923',
  String? pickedBoxBarcode,
}) {
  return PickingLine(
    id: 'line-1',
    productName: 'Test',
    sku: 'C0406',
    barcode: barcode,
    locationCode: 'P-AR-01',
    batch: 'B1',
    expiryDate: null,
    qtyRequired: 16,
    qtyPicked: 16,
    skipReason: null,
    productId: 'prod-1',
    alternateLocations: const <PickingAlternateLocation>[],
    pickedBoxBarcode: pickedBoxBarcode,
  );
}

void main() {
  test('barcodesEqual is case-insensitive', () {
    expect(barcodesEqual('BOX-A', 'box-a'), isTrue);
    expect(barcodesEqual('1', '2'), isFalse);
  });

  test('boxBarcodeMatchesPickedExpectation matches expected list', () {
    expect(
      boxBarcodeMatchesPickedExpectation('BOX-REAL', <String>['BOX-REAL']),
      isTrue,
    );
    expect(
      boxBarcodeMatchesPickedExpectation('1', <String>['BOX-REAL']),
      isFalse,
    );
  });

  test('0 box + 2 loose without product scan requires product scan only', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 2,
      boxUnits: 0,
      looseUnits: 2,
      boxCount: 0,
      valid: true,
    );
    final String? msg = controllerHybridVerifyValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      aggPicked: 2,
      boxBarcode: null,
      productBarcode: null,
      verifyLines: <PickingLine>[_verifyLine()],
    );
    expect(msg, StringLookup.t(AppLocale.uz, 'pickHybridScanProductFirst'));
    expect(controllerVerifyRequiresBoxScan(hybrid), isFalse);
    expect(controllerVerifyRequiresProductScan(hybrid), isTrue);
  });

  test('0 box + 2 loose with product scan passes', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 2,
      boxUnits: 0,
      looseUnits: 2,
      boxCount: 0,
      valid: true,
    );
    final String? msg = controllerHybridVerifyValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      aggPicked: 2,
      boxBarcode: null,
      productBarcode: '4620018872923',
      verifyLines: <PickingLine>[_verifyLine()],
    );
    expect(msg, isNull);
  });

  test('0 box + 2 loose rejects wrong manual product barcode', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 2,
      boxUnits: 0,
      looseUnits: 2,
      boxCount: 0,
      valid: true,
    );
    final String? msg = controllerHybridVerifyValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      aggPicked: 2,
      boxBarcode: null,
      productBarcode: '1',
      verifyLines: <PickingLine>[_verifyLine()],
    );
    expect(
      msg,
      '${StringLookup.t(AppLocale.uz, 'wrongBarcodeMessage')}4620018872923',
    );
  });

  test('1 box + 0 loose without box scan requires box scan', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 8,
      boxUnits: 8,
      looseUnits: 0,
      boxCount: 1,
      valid: true,
    );
    final String? msg = controllerHybridVerifyValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      aggPicked: 8,
      boxBarcode: null,
      productBarcode: null,
      verifyLines: <PickingLine>[_verifyLine(pickedBoxBarcode: 'BOX-1')],
    );
    expect(msg, StringLookup.t(AppLocale.uz, 'pickHybridScanBoxFirst'));
    expect(controllerVerifyRequiresBoxScan(hybrid), isTrue);
    expect(controllerVerifyRequiresProductScan(hybrid), isFalse);
  });

  test('1 box + 0 loose with matching box scan passes', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 8,
      boxUnits: 8,
      looseUnits: 0,
      boxCount: 1,
      valid: true,
    );
    final String? msg = controllerHybridVerifyValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      aggPicked: 8,
      boxBarcode: 'BOX-1',
      productBarcode: null,
      verifyLines: <PickingLine>[_verifyLine(pickedBoxBarcode: 'BOX-1')],
    );
    expect(msg, isNull);
  });

  test('1 box + 0 loose rejects wrong manual box barcode', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 16,
      boxUnits: 16,
      looseUnits: 0,
      boxCount: 1,
      valid: true,
    );
    final String? msg = controllerHybridVerifyValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      aggPicked: 16,
      boxBarcode: '1',
      productBarcode: null,
      verifyLines: <PickingLine>[_verifyLine(pickedBoxBarcode: 'BOX-REAL')],
    );
    expect(
      msg,
      '${StringLookup.t(AppLocale.uz, 'wrongBarcodeMessage')}BOX-REAL',
    );
  });

  test('1 box + 2 loose with box scan only requires product scan', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 10,
      boxUnits: 8,
      looseUnits: 2,
      boxCount: 1,
      valid: true,
    );
    final String? msg = controllerHybridVerifyValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      aggPicked: 10,
      boxBarcode: 'BOX-1',
      productBarcode: null,
      verifyLines: <PickingLine>[_verifyLine(pickedBoxBarcode: 'BOX-1')],
    );
    expect(msg, StringLookup.t(AppLocale.uz, 'pickHybridScanProductFirst'));
  });

  test('1 box + 2 loose with both scans passes', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 10,
      boxUnits: 8,
      looseUnits: 2,
      boxCount: 1,
      valid: true,
    );
    final String? msg = controllerHybridVerifyValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      aggPicked: 10,
      boxBarcode: 'BOX-1',
      productBarcode: '4620018872923',
      verifyLines: <PickingLine>[_verifyLine(pickedBoxBarcode: 'BOX-1')],
    );
    expect(msg, isNull);
  });

  test('box-only stock does not trigger pickUseBoxScan for controller verify', () {
    const PickHybridQty hybrid = PickHybridQty(
      total: 2,
      boxUnits: 0,
      looseUnits: 2,
      boxCount: 0,
      valid: true,
    );
    final String? stockMsg = hybridBoxOnlyStockValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      primaryLooseUnits: 0,
      primaryBoxCount: 131,
    );
    expect(stockMsg, StringLookup.t(AppLocale.uz, 'pickHybridScanBoxFirst'));

    final String? verifyMsg = controllerHybridVerifyValidationMessage(
      loc: AppLocale.uz,
      hybrid: hybrid,
      aggPicked: 2,
      boxBarcode: null,
      productBarcode: '4620018872923',
      verifyLines: <PickingLine>[_verifyLine()],
    );
    expect(verifyMsg, isNull);
    expect(verifyMsg, isNot(StringLookup.t(AppLocale.uz, 'pickUseBoxScan')));
  });

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
      productBarcode: '4620018872923',
      verifyLines: <PickingLine>[_verifyLine(pickedBoxBarcode: 'BOX-1')],
    );
    expect(msg, StringLookup.t(AppLocale.uz, 'qtyMismatch'));
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
