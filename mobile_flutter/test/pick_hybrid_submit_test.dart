import 'package:flutter_test/flutter_test.dart';
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
}
