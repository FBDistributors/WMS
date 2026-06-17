import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/kirim/presentation/inventory_box_save.dart';
import 'package:mobile_flutter/features/product_boxes/data/box_location_models.dart';

BoxLocationBreakdown _breakdown({
  int boxCount = 0,
  int unitsInBoxes = 0,
  int looseUnits = 6,
  int totalUnits = 6,
  List<SealedBoxInfo> sealedBoxes = const <SealedBoxInfo>[],
  bool dataInconsistent = false,
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
    dataInconsistent: dataInconsistent,
  );
}

void main() {
  test('BoxLocationBreakdown parses data_inconsistent flag', () {
    final BoxLocationBreakdown parsed = BoxLocationBreakdown.fromJson(<String, Object?>{
      'product_id': 'p1',
      'lot_id': 'lot1',
      'location_id': 'loc1',
      'box_count': 0,
      'units_in_boxes': 0,
      'loose_units': 100,
      'total_units': 100,
      'data_inconsistent': true,
      'sealed_boxes': <Map<String, Object?>>[
        <String, Object?>{
          'placement_id': 'pl1',
          'product_box_id': 'pb1',
          'box_barcode': 'BOX-X',
          'units_per_box': 120,
        },
      ],
    });
    expect(parsed.dataInconsistent, isTrue);
    expect(parsed.sealedBoxes, hasLength(1));
    expect(parsed.looseUnits, 100);
  });

  test('isBreakdownInconsistentMessage detects backend detail', () {
    expect(
      isBreakdownInconsistentMessage(
        'Exception: Qutilardagi dona jami qoldiqdan oshib ketgan (ma\'lumot nomuvofiqligi)',
      ),
      isTrue,
    );
    expect(isBreakdownInconsistentMessage('Exception: not found'), isFalse);
  });

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

  test('applyInventoryBoxSave reconciles orphaned sealed when inconsistent and 0 boxes',
      () async {
    BoxLocationBreakdown state = _breakdown(
      looseUnits: 100,
      totalUnits: 100,
      dataInconsistent: true,
      sealedBoxes: <SealedBoxInfo>[
        const SealedBoxInfo(
          placementId: 'pl1',
          productBoxId: 'pb1',
          boxBarcode: 'ORPHAN',
          unitsPerBox: 120,
        ),
      ],
    );
    final List<String> ops = <String>[];

    Future<BoxLocationBreakdown> getBreakdown() async => state;

    Future<BoxLocationBreakdown> removeBox({required String boxBarcode}) async {
      ops.add('remove:$boxBarcode');
      state = _breakdown(
        looseUnits: 100,
        totalUnits: 100,
        dataInconsistent: false,
      );
      return state;
    }

    await applyInventoryBoxSave(
      boxBarcode: null,
      unitsPerBox: null,
      targetBoxCount: 0,
      targetLooseQty: 100,
      productId: 'p1',
      locationId: 'loc1',
      lotId: 'lot1',
      getBreakdown: getBreakdown,
      placeBox: ({required String boxBarcode, required int boxCount}) async => state,
      removeBox: removeBox,
      createMovement: ({
        required String productId,
        required String lotId,
        required String locationId,
        required double qtyChange,
        required String reasonCode,
      }) async {},
    );

    expect(ops, <String>['remove:ORPHAN']);
    expect(state.dataInconsistent, isFalse);
  });

  test('inventoryBoxSaveHasChanges uses displayed box count when inconsistent', () {
    final BoxLocationBreakdown b = _breakdown(
      boxCount: 0,
      looseUnits: 4,
      totalUnits: 4,
      dataInconsistent: true,
      sealedBoxes: List<SealedBoxInfo>.generate(
        8,
        (int i) => SealedBoxInfo(
          placementId: 'pl$i',
          productBoxId: 'pb1',
          boxBarcode: '14607953913772',
          unitsPerBox: 12,
        ),
      ),
    );
    expect(
      inventoryBoxSaveHasChanges(
        breakdown: b,
        boxBarcode: '14607953913772',
        targetBoxCount: 8,
        targetLooseQty: 4,
      ),
      isTrue,
    );
    expect(currentBoxCountTarget(b, '14607953913772'), 0);
  });

  test('applyInventoryBoxSave reconciles then places when inconsistent and 8 boxes',
      () async {
    BoxLocationBreakdown state = _breakdown(
      boxCount: 0,
      looseUnits: 4,
      totalUnits: 4,
      dataInconsistent: true,
      sealedBoxes: List<SealedBoxInfo>.generate(
        8,
        (int i) => SealedBoxInfo(
          placementId: 'pl$i',
          productBoxId: 'pb1',
          boxBarcode: 'BOX-A',
          unitsPerBox: 12,
        ),
      ),
    );
    final List<String> ops = <String>[];

    Future<BoxLocationBreakdown> getBreakdown() async => state;

    Future<BoxLocationBreakdown> removeBox({required String boxBarcode}) async {
      ops.add('remove:$boxBarcode');
      state = _breakdown(
        boxCount: 0,
        looseUnits: 4,
        totalUnits: 4,
        dataInconsistent: false,
      );
      return state;
    }

    Future<BoxLocationBreakdown> placeBox({
      required String boxBarcode,
      required int boxCount,
    }) async {
      ops.add('place:$boxCount');
      state = _breakdown(
        boxCount: boxCount,
        unitsInBoxes: boxCount * 12,
        looseUnits: 4,
        totalUnits: 100,
        dataInconsistent: false,
      );
      return state;
    }

    await applyInventoryBoxSave(
      boxBarcode: 'BOX-A',
      unitsPerBox: 12,
      targetBoxCount: 8,
      targetLooseQty: 4,
      productId: 'p1',
      locationId: 'loc1',
      lotId: 'lot1',
      getBreakdown: getBreakdown,
      placeBox: placeBox,
      removeBox: removeBox,
      createMovement: ({
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
          looseUnits: state.looseUnits,
          totalUnits: state.totalUnits + qtyChange.round(),
          dataInconsistent: false,
        );
      },
    );

    expect(ops.where((String o) => o.startsWith('remove:')).length, 8);
    expect(ops.any((String o) => o == 'movement:inventory_overage:96.0'), isTrue);
    expect(ops.any((String o) => o == 'place:8'), isTrue);
  });
}
