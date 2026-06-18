import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/product_boxes/box_qty_breakdown.dart';

void main() {
  test('50 dona, 12/quti → 4 to\'liq, 2 ochiq', () {
    final BoxQtyBreakdown? b = computeBoxQtyBreakdown(
      availableQty: 50,
      unitsPerBox: 12,
    );
    expect(b, isNotNull);
    expect(b!.fullBoxes, 4);
    expect(b.looseUnits, 2);
    expect(b.totalUnits, 50);
    expect(b.unitsPerBox, 12);
  });

  test('24 dona, 12/quti → 2 to\'liq, 0 ochiq', () {
    final BoxQtyBreakdown? b = computeBoxQtyBreakdown(
      availableQty: 24,
      unitsPerBox: 12,
    );
    expect(b!.fullBoxes, 2);
    expect(b.looseUnits, 0);
    expect(b.totalUnits, 24);
  });

  test('unitsPerBox < 1 → null', () {
    expect(
      computeBoxQtyBreakdown(availableQty: 10, unitsPerBox: 0),
      isNull,
    );
  });

  test('availableQty yaxlitlanadi', () {
    final BoxQtyBreakdown? b = computeBoxQtyBreakdown(
      availableQty: 50.4,
      unitsPerBox: 12,
    );
    expect(b!.totalUnits, 50);
    expect(b.fullBoxes, 4);
    expect(b.looseUnits, 2);
  });

  test('computeHybridPickPlan 10 dona 8/quti ochiq dona yo\'q', () {
    final HybridPickPlan? p = computeHybridPickPlan(
      total: 10,
      unitsPerBox: 8,
      availableLoose: 0,
    );
    expect(p, isNotNull);
    expect(p!.fullBoxes, 1);
    expect(p.looseNeeded, 2);
    expect(p.boxesToOpen, 1);
    expect(p.totalBoxesConsumed, 2);
  });

  test('computeHybridPickPlan ochiq dona yetganda quti ochilmaydi', () {
    final HybridPickPlan? p = computeHybridPickPlan(
      total: 10,
      unitsPerBox: 8,
      availableLoose: 5,
    );
    expect(p!.looseFromStock, 2);
    expect(p.boxesToOpen, 0);
    expect(p.totalBoxesConsumed, 1);
  });

  test('computeConsolidatedBoxLoosePlan A4 B5 C6 UPB8', () {
    final ({int boxCount, int looseQty})? plan = computeConsolidatedBoxLoosePlan(
      lineRemainders: <int>[4, 5, 6],
      unitsPerBox: 8,
    );
    expect(plan, isNotNull);
    expect(plan!.boxCount, 0);
    expect(plan.looseQty, 15);
  });

  test('computeConsolidatedBoxLoosePlan A4 B5 C8 UPB8', () {
    final ({int boxCount, int looseQty})? plan = computeConsolidatedBoxLoosePlan(
      lineRemainders: <int>[4, 5, 8],
      unitsPerBox: 8,
    );
    expect(plan!.boxCount, 1);
    expect(plan.looseQty, 9);
  });

  test('computeConsolidatedBoxLoosePlan A4 B5 C16 UPB8', () {
    final ({int boxCount, int looseQty})? plan = computeConsolidatedBoxLoosePlan(
      lineRemainders: <int>[4, 5, 16],
      unitsPerBox: 8,
    );
    expect(plan!.boxCount, 2);
    expect(plan.looseQty, 9);
  });

  test('consolidatedRemaindersByDocument bir hujjat qatorlari yigiladi', () {
    final List<int> rem = consolidatedRemaindersByDocument(
      lines: <({String documentId, double qtyRequired, double qtyPicked})>[
        (documentId: 'd1', qtyRequired: 4, qtyPicked: 0),
        (documentId: 'd1', qtyRequired: 2, qtyPicked: 0),
        (documentId: 'd2', qtyRequired: 5, qtyPicked: 0),
      ],
    );
    expect(rem, <int>[6, 5]);
  });
}
