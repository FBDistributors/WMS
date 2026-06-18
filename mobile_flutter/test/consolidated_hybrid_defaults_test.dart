import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/picking/data/picking_models.dart';
import 'package:mobile_flutter/shared/widgets/pick_box_qty_fields.dart';

ConsolidatedLineItem _line({
  required String docId,
  required String ref,
  required double req,
  double picked = 0,
}) {
  return ConsolidatedLineItem(
    documentId: docId,
    lineId: '$docId-line',
    referenceNumber: ref,
    qtyRequired: req,
    qtyPicked: picked,
    locationCode: 'P-01',
    pickSequence: 1,
    expiryDate: null,
  );
}

void main() {
  test('applyConsolidatedHybridQtyDefaults 2+ buyurtma buyurtma bo\'yicha', () {
    final TextEditingController boxCount = TextEditingController();
    final TextEditingController looseQty = TextEditingController();
    final List<ConsolidatedLineItem> lines = <ConsolidatedLineItem>[
      _line(docId: 'a', ref: 'A', req: 4),
      _line(docId: 'b', ref: 'B', req: 5),
      _line(docId: 'c', ref: 'C', req: 6),
    ];
    applyConsolidatedHybridQtyDefaults(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 8,
      maxUnits: 15,
      lines: lines,
    );
    expect(boxCount.text, '0');
    expect(looseQty.text, '15');
    boxCount.dispose();
    looseQty.dispose();
  });

  test('applyConsolidatedHybridQtyDefaults bitta buyurtmada jami mantiq', () {
    final TextEditingController boxCount = TextEditingController();
    final TextEditingController looseQty = TextEditingController();
    final List<ConsolidatedLineItem> lines = <ConsolidatedLineItem>[
      _line(docId: 'a', ref: 'A', req: 17),
    ];
    applyConsolidatedHybridQtyDefaults(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 8,
      maxUnits: 17,
      lines: lines,
    );
    expect(boxCount.text, '2');
    expect(looseQty.text, '1');
    boxCount.dispose();
    looseQty.dispose();
  });

  test('applyConsolidatedHybridQtyDefaults API suggested ustun', () {
    final TextEditingController boxCount = TextEditingController();
    final TextEditingController looseQty = TextEditingController();
    final List<ConsolidatedLineItem> lines = <ConsolidatedLineItem>[
      _line(docId: 'a', ref: 'A', req: 4),
      _line(docId: 'b', ref: 'B', req: 5),
      _line(docId: 'c', ref: 'C', req: 8),
    ];
    applyConsolidatedHybridQtyDefaults(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 8,
      maxUnits: 17,
      lines: lines,
      suggestedBoxCount: 1,
      suggestedLooseQty: 9,
    );
    expect(boxCount.text, '1');
    expect(looseQty.text, '9');
    boxCount.dispose();
    looseQty.dispose();
  });
}
