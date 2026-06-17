import '../../inventory/data/models/picker_inventory_models.dart';
import '../../product_boxes/data/box_location_models.dart';

int sealedBoxCountForBarcode(BoxLocationBreakdown breakdown, String barcode) {
  final String normalized = barcode.trim();
  if (normalized.isEmpty) {
    return 0;
  }
  return breakdown.sealedBoxes
      .where((SealedBoxInfo s) => s.boxBarcode.trim() == normalized)
      .length;
}

int currentBoxCountTarget(BoxLocationBreakdown breakdown, String barcode) {
  if (breakdown.dataInconsistent) {
    return breakdown.boxCount;
  }
  if (barcode.trim().isNotEmpty) {
    return sealedBoxCountForBarcode(breakdown, barcode);
  }
  return breakdown.boxCount;
}

int? inventoryTargetTotalUnits({
  required int targetBoxCount,
  required int targetLooseQty,
  required int? unitsPerBox,
  required BoxLocationBreakdown breakdown,
  required int boxDelta,
}) {
  if (unitsPerBox != null && unitsPerBox >= 1) {
    return targetBoxCount * unitsPerBox + targetLooseQty;
  }
  if (boxDelta == 0) {
    return breakdown.unitsInBoxes + targetLooseQty;
  }
  return null;
}

({int? needed, int? available})? parseInsufficientLooseMessage(String message) {
  final RegExpMatch? match =
      RegExp(r'insufficient_loose:(\d+):(\d+)').firstMatch(message);
  if (match == null) {
    return null;
  }
  return (
    needed: int.tryParse(match.group(1)!),
    available: int.tryParse(match.group(2)!),
  );
}

class InventoryBoxSavePartialFailure implements Exception {
  InventoryBoxSavePartialFailure({
    required this.boxOpsCompleted,
    required this.cause,
  });

  final bool boxOpsCompleted;
  final Object cause;

  @override
  String toString() => '$cause';
}

typedef InventoryGetBreakdownFn = Future<BoxLocationBreakdown> Function();
typedef InventoryPlaceBoxFn = Future<BoxLocationBreakdown> Function({
  required String boxBarcode,
  required int boxCount,
});
typedef InventoryRemoveBoxFn = Future<BoxLocationBreakdown> Function({
  required String boxBarcode,
});
typedef InventoryCreateMovementFn = Future<void> Function({
  required String productId,
  required String lotId,
  required String locationId,
  required double qtyChange,
  required String reasonCode,
});

/// Quti soni + qutisiz dona bo'yicha inventarizatsiya: avval jami, keyin quti.
Future<BoxLocationBreakdown> applyInventoryBoxSave({
  required String? boxBarcode,
  required int? unitsPerBox,
  required int targetBoxCount,
  required int targetLooseQty,
  required InventoryGetBreakdownFn getBreakdown,
  required InventoryPlaceBoxFn placeBox,
  required InventoryRemoveBoxFn removeBox,
  required InventoryCreateMovementFn createMovement,
  required String productId,
  required String locationId,
  required String lotId,
  List<PickerProductLocation>? looseAdjustLots,
}) async {
  final String barcode = boxBarcode?.trim() ?? '';
  BoxLocationBreakdown breakdown = await getBreakdown();

  if (breakdown.dataInconsistent && breakdown.sealedBoxes.isNotEmpty) {
    final List<SealedBoxInfo> sealed =
        List<SealedBoxInfo>.from(breakdown.sealedBoxes);
    for (final SealedBoxInfo sealedBox in sealed) {
      breakdown = await removeBox(boxBarcode: sealedBox.boxBarcode);
    }
    breakdown = await getBreakdown();
  }

  final int currentBoxes = currentBoxCountTarget(breakdown, barcode);
  final int boxDelta = targetBoxCount - currentBoxes;
  bool boxOpsCompleted = false;

  if (boxDelta != 0) {
    if (barcode.isEmpty || unitsPerBox == null || unitsPerBox < 1) {
      throw Exception('box_barcode_required');
    }
  }

  if (boxDelta < 0) {
    for (int i = 0; i < -boxDelta; i++) {
      breakdown = await removeBox(boxBarcode: barcode);
    }
    boxOpsCompleted = true;
    breakdown = await getBreakdown();
  }

  final int? targetTotal = inventoryTargetTotalUnits(
    targetBoxCount: targetBoxCount,
    targetLooseQty: targetLooseQty,
    unitsPerBox: unitsPerBox,
    breakdown: breakdown,
    boxDelta: boxDelta,
  );

  try {
    int appliedTotalDelta = 0;
    if (targetTotal != null) {
      final int totalDelta = targetTotal - breakdown.totalUnits;
      if (totalDelta != 0) {
        appliedTotalDelta = totalDelta;
        await _applyTotalAdjust(
          totalDelta: totalDelta,
          productId: productId,
          lotId: lotId,
          locationId: locationId,
          createMovement: createMovement,
        );
        breakdown = await getBreakdown();
      }
    }

    if (boxDelta > 0) {
      breakdown = await placeBox(boxBarcode: barcode, boxCount: boxDelta);
      boxOpsCompleted = true;
      breakdown = await getBreakdown();
    }

    final bool looseCoveredByTotalAdjust = boxDelta == 0 && appliedTotalDelta != 0;
    if (!looseCoveredByTotalAdjust) {
      await _applyLooseAdjust(
        productId: productId,
        locationId: locationId,
        lotId: lotId,
        breakdownLoose: breakdown.looseUnits,
        targetLooseQty: targetLooseQty,
        createMovement: createMovement,
        looseAdjustLots: looseAdjustLots,
      );
    }
  } on Object catch (e) {
    if (boxOpsCompleted) {
      throw InventoryBoxSavePartialFailure(boxOpsCompleted: true, cause: e);
    }
    rethrow;
  }

  return getBreakdown();
}

Future<void> _applyTotalAdjust({
  required int totalDelta,
  required String productId,
  required String lotId,
  required String locationId,
  required InventoryCreateMovementFn createMovement,
}) async {
  if (totalDelta == 0) {
    return;
  }
  await createMovement(
    productId: productId,
    lotId: lotId,
    locationId: locationId,
    qtyChange: totalDelta.toDouble(),
    reasonCode: totalDelta > 0 ? 'inventory_overage' : 'inventory_shortage',
  );
}

Future<void> _applyLooseAdjust({
  required String productId,
  required String locationId,
  required String lotId,
  required int breakdownLoose,
  required int targetLooseQty,
  required InventoryCreateMovementFn createMovement,
  List<PickerProductLocation>? looseAdjustLots,
}) async {
  if (looseAdjustLots != null && looseAdjustLots.isNotEmpty) {
    final int current =
        looseAdjustLots.fold(0, (int s, PickerProductLocation l) => s + l.looseUnits);
    final int delta = targetLooseQty - current;
    if (delta == 0) {
      return;
    }
    if (delta > 0) {
      final PickerProductLocation target = looseAdjustLots.firstWhere(
        (PickerProductLocation l) => l.looseUnits > 0,
        orElse: () => looseAdjustLots.first,
      );
      await createMovement(
        productId: productId,
        lotId: target.lotId,
        locationId: target.locationId,
        qtyChange: delta.toDouble(),
        reasonCode: 'inventory_overage',
      );
      return;
    }
    double remaining = (-delta).toDouble();
    final List<PickerProductLocation> ordered = List<PickerProductLocation>.from(looseAdjustLots)
      ..sort(
        (PickerProductLocation a, PickerProductLocation b) =>
            b.looseUnits.compareTo(a.looseUnits),
      );
    for (final PickerProductLocation lot in ordered) {
      if (remaining <= 0) {
        break;
      }
      final double take = remaining < lot.availableQty ? remaining : lot.availableQty;
      if (take <= 0) {
        continue;
      }
      await createMovement(
        productId: productId,
        lotId: lot.lotId,
        locationId: lot.locationId,
        qtyChange: -take,
        reasonCode: 'inventory_shortage',
      );
      remaining -= take;
    }
    if (remaining > 0) {
      await createMovement(
        productId: productId,
        lotId: looseAdjustLots.first.lotId,
        locationId: locationId,
        qtyChange: -remaining,
        reasonCode: 'inventory_shortage',
      );
    }
    return;
  }

  final int delta = targetLooseQty - breakdownLoose;
  if (delta == 0) {
    return;
  }
  await createMovement(
    productId: productId,
    lotId: lotId,
    locationId: locationId,
    qtyChange: delta.toDouble(),
    reasonCode: delta > 0 ? 'inventory_overage' : 'inventory_shortage',
  );
}

bool inventoryBoxSaveHasChanges({
  required BoxLocationBreakdown breakdown,
  required String? boxBarcode,
  required int targetBoxCount,
  required int targetLooseQty,
  List<PickerProductLocation>? looseAdjustLots,
}) {
  final int currentBoxes = currentBoxCountTarget(breakdown, boxBarcode?.trim() ?? '');
  final int currentLoose = looseAdjustLots != null && looseAdjustLots.isNotEmpty
      ? looseAdjustLots.fold(0, (int s, PickerProductLocation l) => s + l.looseUnits)
      : breakdown.looseUnits;
  return targetBoxCount != currentBoxes || targetLooseQty != currentLoose;
}
