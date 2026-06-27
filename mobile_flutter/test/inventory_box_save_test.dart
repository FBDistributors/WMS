import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/inventory/data/models/picker_inventory_models.dart';
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

  group('inventoryCountAtomicEligible', () {
    const SealedBoxInfo boxA = SealedBoxInfo(
      placementId: 'pl1',
      productBoxId: 'pb1',
      boxBarcode: 'BOX-A',
      unitsPerBox: 6,
    );
    const SealedBoxInfo boxB = SealedBoxInfo(
      placementId: 'pl2',
      productBoxId: 'pb2',
      boxBarcode: 'BOX-B',
      unitsPerBox: 8,
    );

    test('eligible for single lot, single box type, consistent', () {
      expect(
        inventoryCountAtomicEligible(
          breakdown: _breakdown(sealedBoxes: <SealedBoxInfo>[boxA]),
          boxBarcode: 'BOX-A',
          unitsPerBox: 6,
        ),
        isTrue,
      );
    });

    test('not eligible when data inconsistent', () {
      expect(
        inventoryCountAtomicEligible(
          breakdown: _breakdown(dataInconsistent: true),
          boxBarcode: 'BOX-A',
          unitsPerBox: 6,
        ),
        isFalse,
      );
    });

    test('not eligible with multi-lot loose adjust', () {
      expect(
        inventoryCountAtomicEligible(
          breakdown: _breakdown(),
          boxBarcode: 'BOX-A',
          unitsPerBox: 6,
          looseAdjustLots: <PickerProductLocation>[
            const PickerProductLocation(
              locationId: 'locX',
              locationCode: 'X',
              lotId: 'lotX',
              batchNo: 'B1',
              expiryDate: null,
              onHandQty: 5,
              reservedQty: 0,
              availableQty: 5,
              looseUnits: 5,
            ),
          ],
        ),
        isFalse,
      );
    });

    test('not eligible when a foreign box type is present', () {
      expect(
        inventoryCountAtomicEligible(
          breakdown: _breakdown(sealedBoxes: <SealedBoxInfo>[boxA, boxB]),
          boxBarcode: 'BOX-A',
          unitsPerBox: 6,
        ),
        isFalse,
      );
    });

    test('not eligible without barcode or units', () {
      expect(
        inventoryCountAtomicEligible(
          breakdown: _breakdown(),
          boxBarcode: '',
          unitsPerBox: 6,
        ),
        isFalse,
      );
      expect(
        inventoryCountAtomicEligible(
          breakdown: _breakdown(),
          boxBarcode: 'BOX-A',
          unitsPerBox: null,
        ),
        isFalse,
      );
    });
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

  test('applyInventoryBoxSave does not double-count loose when looseAdjustLots set',
      () async {
    final List<SealedBoxInfo> sealed = List<SealedBoxInfo>.generate(
      73,
      (int i) => SealedBoxInfo(
        placementId: 'pl$i',
        productBoxId: 'pb1',
        boxBarcode: '14607953918135',
        unitsPerBox: 12,
      ),
    );
    BoxLocationBreakdown state = _breakdown(
      boxCount: 73,
      unitsInBoxes: 876,
      looseUnits: 6,
      totalUnits: 882,
      sealedBoxes: sealed,
    );
    final List<String> ops = <String>[];
    final List<PickerProductLocation> lots = <PickerProductLocation>[
      const PickerProductLocation(
        locationId: 'loc1',
        locationCode: 'P-AR-03',
        lotId: 'lot1',
        batchNo: 'B1',
        expiryDate: '2029-01-01',
        onHandQty: 882,
        reservedQty: 0,
        availableQty: 882,
        boxCount: 73,
        unitsInBoxes: 876,
        looseUnits: 6,
      ),
    ];

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

    await applyInventoryBoxSave(
      boxBarcode: '14607953918135',
      unitsPerBox: 12,
      targetBoxCount: 73,
      targetLooseQty: 8,
      productId: 'p1',
      locationId: 'loc1',
      lotId: 'lot1',
      looseAdjustLots: lots,
      getBreakdown: getBreakdown,
      placeBox: ({required String boxBarcode, required int boxCount}) async => state,
      removeBox: ({required String boxBarcode}) async => state,
      createMovement: createMovement,
    );

    expect(ops, <String>['movement:inventory_overage:2.0']);
    expect(state.looseUnits, 8);
    expect(state.totalUnits, 884);
  });

  test('inventoryTargetTotalUnits uses corrected units per box', () {
    final BoxLocationBreakdown b = _breakdown(
      boxCount: 23,
      unitsInBoxes: 230,
      looseUnits: 0,
      totalUnits: 230,
    );
    final int? total = inventoryTargetTotalUnits(
      targetBoxCount: 23,
      targetLooseQty: 0,
      unitsPerBox: 12,
      breakdown: b,
      boxDelta: 0,
    );
    expect(total, 276);
  });

  test('computeInventoryPreviewTotal matches box×upb+loose formula', () {
    expect(
      computeInventoryPreviewTotal(
        targetBoxCount: 108,
        targetLooseQty: 0,
        unitsPerBox: 8,
      ),
      864,
    );
    expect(
      computeInventoryPreviewTotal(
        targetBoxCount: 100,
        targetLooseQty: 0,
        unitsPerBox: 8,
      ),
      800,
    );
    expect(
      computeInventoryPreviewTotal(
        targetBoxCount: 0,
        targetLooseQty: 5,
        unitsPerBox: 8,
      ),
      5,
    );
  });

  test('applyInventoryBoxSave 108→0 boxes with 0 loose zeros stock', () async {
    final _InventorySaveSimulator sim = _InventorySaveSimulator(
      barcode: '14607953910108',
      unitsPerBox: 8,
      sealedCount: 108,
      looseUnits: 0,
    );
    final List<String> ops = <String>[];

    Future<BoxLocationBreakdown> getBreakdown() async => sim.snapshot();

    Future<BoxLocationBreakdown> removeBox({required String boxBarcode}) async {
      ops.add('remove');
      sim.removeOneBox();
      return sim.snapshot();
    }

    Future<void> createMovement({
      required String productId,
      required String lotId,
      required String locationId,
      required double qtyChange,
      required String reasonCode,
    }) async {
      ops.add('movement:$reasonCode:$qtyChange');
      sim.applyMovement(qtyChange);
    }

    final BoxLocationBreakdown result = await applyInventoryBoxSave(
      boxBarcode: sim.barcode,
      unitsPerBox: sim.unitsPerBox,
      targetBoxCount: 0,
      targetLooseQty: 0,
      productId: 'p1',
      locationId: 'loc1',
      lotId: 'lot1',
      getBreakdown: getBreakdown,
      placeBox: ({required String boxBarcode, required int boxCount}) async =>
          sim.snapshot(),
      removeBox: removeBox,
      createMovement: createMovement,
    );

    expect(ops.where((String o) => o == 'remove').length, 108);
    expect(
      ops.where((String o) => o == 'movement:inventory_shortage:-864.0').length,
      1,
    );
    expect(result.boxCount, 0);
    expect(result.looseUnits, 0);
    expect(result.totalUnits, 0);
  });

  test('applyInventoryBoxSave 108→0 boxes keeps 5 loose', () async {
    final _InventorySaveSimulator sim = _InventorySaveSimulator(
      barcode: '14607953910108',
      unitsPerBox: 8,
      sealedCount: 108,
      looseUnits: 5,
    );
    final List<String> ops = <String>[];

    Future<BoxLocationBreakdown> getBreakdown() async => sim.snapshot();

    Future<BoxLocationBreakdown> removeBox({required String boxBarcode}) async {
      ops.add('remove');
      sim.removeOneBox();
      return sim.snapshot();
    }

    Future<void> createMovement({
      required String productId,
      required String lotId,
      required String locationId,
      required double qtyChange,
      required String reasonCode,
    }) async {
      ops.add('movement:$reasonCode:$qtyChange');
      sim.applyMovement(qtyChange);
    }

    final BoxLocationBreakdown result = await applyInventoryBoxSave(
      boxBarcode: sim.barcode,
      unitsPerBox: sim.unitsPerBox,
      targetBoxCount: 0,
      targetLooseQty: 5,
      productId: 'p1',
      locationId: 'loc1',
      lotId: 'lot1',
      getBreakdown: getBreakdown,
      placeBox: ({required String boxBarcode, required int boxCount}) async =>
          sim.snapshot(),
      removeBox: removeBox,
      createMovement: createMovement,
    );

    expect(ops.where((String o) => o == 'remove').length, 108);
    expect(
      ops.where((String o) => o == 'movement:inventory_shortage:-864.0').length,
      1,
    );
    expect(result.boxCount, 0);
    expect(result.looseUnits, 5);
    expect(result.totalUnits, 5);
  });

  test('applyInventoryBoxSave loose→0 keeps 108 boxes', () async {
    final _InventorySaveSimulator sim = _InventorySaveSimulator(
      barcode: '14607953910108',
      unitsPerBox: 8,
      sealedCount: 108,
      looseUnits: 5,
    );
    final List<String> ops = <String>[];

    Future<BoxLocationBreakdown> getBreakdown() async => sim.snapshot();

    Future<void> createMovement({
      required String productId,
      required String lotId,
      required String locationId,
      required double qtyChange,
      required String reasonCode,
    }) async {
      ops.add('movement:$reasonCode:$qtyChange');
      sim.applyMovement(qtyChange);
    }

    final BoxLocationBreakdown result = await applyInventoryBoxSave(
      boxBarcode: sim.barcode,
      unitsPerBox: sim.unitsPerBox,
      targetBoxCount: 108,
      targetLooseQty: 0,
      productId: 'p1',
      locationId: 'loc1',
      lotId: 'lot1',
      getBreakdown: getBreakdown,
      placeBox: ({required String boxBarcode, required int boxCount}) async =>
          sim.snapshot(),
      removeBox: ({required String boxBarcode}) async => sim.snapshot(),
      createMovement: createMovement,
    );

    expect(ops, <String>['movement:inventory_shortage:-5.0']);
    expect(result.boxCount, 108);
    expect(result.looseUnits, 0);
    expect(result.totalUnits, 864);
  });

  test('applyInventoryBoxSave 108→100 decreases by 64 only', () async {
    final _InventorySaveSimulator sim = _InventorySaveSimulator(
      barcode: '14607953910108',
      unitsPerBox: 8,
      sealedCount: 108,
      looseUnits: 0,
    );
    final List<String> ops = <String>[];

    Future<BoxLocationBreakdown> getBreakdown() async => sim.snapshot();

    Future<BoxLocationBreakdown> removeBox({required String boxBarcode}) async {
      ops.add('remove');
      sim.removeOneBox();
      return sim.snapshot();
    }

    Future<void> createMovement({
      required String productId,
      required String lotId,
      required String locationId,
      required double qtyChange,
      required String reasonCode,
    }) async {
      ops.add('movement:$reasonCode:$qtyChange');
      sim.applyMovement(qtyChange);
    }

    final BoxLocationBreakdown result = await applyInventoryBoxSave(
      boxBarcode: sim.barcode,
      unitsPerBox: sim.unitsPerBox,
      targetBoxCount: 100,
      targetLooseQty: 0,
      productId: 'p1',
      locationId: 'loc1',
      lotId: 'lot1',
      getBreakdown: getBreakdown,
      placeBox: ({required String boxBarcode, required int boxCount}) async =>
          sim.snapshot(),
      removeBox: removeBox,
      createMovement: createMovement,
    );

    expect(ops.where((String o) => o == 'remove').length, 8);
    expect(
      ops.where((String o) => o == 'movement:inventory_shortage:-64.0').length,
      1,
    );
    expect(result.boxCount, 100);
    expect(result.looseUnits, 0);
    expect(result.totalUnits, 800);
  });

  test('applyInventoryBoxSave upb increase without box change', () async {
    final _InventorySaveSimulator sim = _InventorySaveSimulator(
      barcode: '14607953910108',
      unitsPerBox: 8,
      sealedCount: 108,
      looseUnits: 0,
    );
    final List<String> ops = <String>[];

    Future<BoxLocationBreakdown> getBreakdown() async => sim.snapshot();

    Future<void> createMovement({
      required String productId,
      required String lotId,
      required String locationId,
      required double qtyChange,
      required String reasonCode,
    }) async {
      ops.add('movement:$reasonCode:$qtyChange');
      sim.applyMovement(qtyChange);
    }

    final BoxLocationBreakdown result = await applyInventoryBoxSave(
      boxBarcode: sim.barcode,
      unitsPerBox: 10,
      targetBoxCount: 108,
      targetLooseQty: 0,
      productId: 'p1',
      locationId: 'loc1',
      lotId: 'lot1',
      getBreakdown: getBreakdown,
      placeBox: ({required String boxBarcode, required int boxCount}) async =>
          sim.snapshot(),
      removeBox: ({required String boxBarcode}) async => sim.snapshot(),
      createMovement: createMovement,
    );

    expect(ops, <String>['movement:inventory_overage:216.0']);
    expect(result.boxCount, 108);
    expect(result.totalUnits, 1080);
  });
}

List<SealedBoxInfo> _sealedBoxes(int count, String barcode, int upb) {
  return List<SealedBoxInfo>.generate(
    count,
    (int i) => SealedBoxInfo(
      placementId: 'pl$i',
      productBoxId: 'pb1',
      boxBarcode: barcode,
      unitsPerBox: upb,
    ),
  );
}

class _InventorySaveSimulator {
  _InventorySaveSimulator({
    required this.barcode,
    required this.unitsPerBox,
    required int sealedCount,
    required this.looseUnits,
  }) : sealedCount = sealedCount;

  final String barcode;
  final int unitsPerBox;
  int sealedCount;
  int looseUnits;

  int get boxCount => sealedCount;
  int get unitsInBoxes => sealedCount * unitsPerBox;
  int get totalUnits => unitsInBoxes + looseUnits;

  BoxLocationBreakdown snapshot() {
    return _breakdown(
      boxCount: boxCount,
      unitsInBoxes: unitsInBoxes,
      looseUnits: looseUnits,
      totalUnits: totalUnits,
      sealedBoxes: _sealedBoxes(sealedCount, barcode, unitsPerBox),
    );
  }

  void removeOneBox() {
    if (sealedCount <= 0) {
      return;
    }
    sealedCount--;
    looseUnits += unitsPerBox;
  }

  void applyMovement(double qtyChange) {
    looseUnits += qtyChange.round();
  }
}
