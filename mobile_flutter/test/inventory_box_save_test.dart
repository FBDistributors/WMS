import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/kirim/presentation/inventory_box_save.dart';
import 'package:mobile_flutter/features/product_boxes/data/box_location_models.dart';

BoxLocationBreakdown _breakdown({
  int boxCount = 0,
  int unitsInBoxes = 0,
  int looseUnits = 6,
  int totalUnits = 6,
  List<SealedBoxInfo> sealedBoxes = const <SealedBoxInfo>[],
}) {
  return BoxLocationBreakdown(
    productId: 'p1',
    lotId: 'lot1',
    locationId: 'loc1',
    boxCount: boxCount,
    unitsInBoxes: unitsInBoxes,
    looseUnits: looseUnits,
    totalUnits: totalUnits,
    sealedBoxes: sealedBoxes,
  );
}

void main() {
  test('parseInsufficientLooseMessage handles Exception prefix', () {
    final ({int? needed, int? available})? parsed = parseInsufficientLooseMessage(
      'Exception: insufficient_loose:30:6',
    );
    expect(parsed?.needed, 30);
    expect(parsed?.available, 6);
  });

  test('inventoryTargetTotalUnits uses box count and loose', () {
    final BoxLocationBreakdown b = _breakdown();
    expect(
      inventoryTargetTotalUnits(
        targetBoxCount: 5,
        targetLooseQty: 6,
        unitsPerBox: 6,
        breakdown: b,
        boxDelta: 5,
      ),
      36,
    );
  });

  test('applyInventoryBoxSave overage before pack when increasing boxes', () async {
    BoxLocationBreakdown state = _breakdown();
    final List<String> ops = <String>[];

    Future<BoxLocationBreakdown> getBreakdown() async => state;

    Future<void> createMovement({
      required String productId,
      required String lotId,
      required String locationId,
      required double qtyChange,
      required String reasonCode,
    }) async {
      ops.add('movement:$reasonCode:$qtyChange');
      state = _breakdown(
        looseUnits: state.looseUnits + qtyChange.round(),
        totalUnits: state.totalUnits + qtyChange.round(),
      );
    }

    Future<BoxLocationBreakdown> placeBox({
      required String boxBarcode,
      required int boxCount,
    }) async {
      ops.add('place:$boxCount');
      final int units = boxCount * 6;
      state = _breakdown(
        boxCount: boxCount,
        unitsInBoxes: units,
        looseUnits: state.looseUnits - units,
        totalUnits: state.totalUnits,
      );
      return state;
    }

    await applyInventoryBoxSave(
      boxBarcode: '133',
      unitsPerBox: 6,
      targetBoxCount: 5,
      targetLooseQty: 6,
      productId: 'p1',
      locationId: 'loc1',
      lotId: 'lot1',
      getBreakdown: getBreakdown,
      placeBox: placeBox,
      removeBox: ({required String boxBarcode}) async => state,
      createMovement: createMovement,
    );

    expect(ops.first, 'movement:inventory_overage:30.0');
    expect(ops.any((String o) => o.startsWith('place:5')), isTrue);
    expect(state.boxCount, 5);
    expect(state.looseUnits, 6);
    expect(state.totalUnits, 36);
  });

  test('applyInventoryBoxSave unpack before shortage when decreasing', () async {
    BoxLocationBreakdown state = _breakdown(
      boxCount: 5,
      unitsInBoxes: 30,
      looseUnits: 6,
      totalUnits: 36,
      sealedBoxes: List<SealedBoxInfo>.generate(
        5,
        (int i) => SealedBoxInfo(
          placementId: 'pl$i',
          productBoxId: 'pb1',
          boxBarcode: '133',
          unitsPerBox: 6,
        ),
      ),
    );
    final List<String> ops = <String>[];

    Future<BoxLocationBreakdown> getBreakdown() async => state;

    Future<void> createMovement({
      required String productId,
      required String lotId,
      required String locationId,
      required double qtyChange,
      required String reasonCode,
    }) async {
      ops.add('movement:$reasonCode:$qtyChange');
      state = _breakdown(
        boxCount: state.boxCount,
        unitsInBoxes: state.unitsInBoxes,
        looseUnits: state.looseUnits + qtyChange.round(),
        totalUnits: state.totalUnits + qtyChange.round(),
      );
    }

    Future<BoxLocationBreakdown> removeBox({required String boxBarcode}) async {
      ops.add('remove');
      state = _breakdown(
        boxCount: 0,
        unitsInBoxes: 0,
        looseUnits: 36,
        totalUnits: 36,
      );
      return state;
    }

    await applyInventoryBoxSave(
      boxBarcode: '133',
      unitsPerBox: 6,
      targetBoxCount: 0,
      targetLooseQty: 10,
      productId: 'p1',
      locationId: 'loc1',
      lotId: 'lot1',
      getBreakdown: getBreakdown,
      placeBox: ({required String boxBarcode, required int boxCount}) async => state,
      removeBox: removeBox,
      createMovement: createMovement,
    );

    expect(ops.first, 'remove');
    expect(
      ops.where((String o) => o.startsWith('movement:inventory_shortage')).length,
      greaterThanOrEqualTo(1),
    );
  });
}
