class BoxQtyBreakdown {
  const BoxQtyBreakdown({
    required this.fullBoxes,
    required this.looseUnits,
    required this.totalUnits,
    required this.unitsPerBox,
  });

  final int fullBoxes;
  final int looseUnits;
  final int totalUnits;
  final int unitsPerBox;
}

/// Gibrid terish rejasi: to'liq qutilar + qisman dona uchun ochiladigan quti.
class HybridPickPlan {
  const HybridPickPlan({
    required this.fullBoxes,
    required this.looseNeeded,
    required this.looseFromStock,
    required this.boxesToOpen,
    required this.totalBoxesConsumed,
  });

  final int fullBoxes;
  final int looseNeeded;
  final int looseFromStock;
  final int boxesToOpen;
  final int totalBoxesConsumed;
}

HybridPickPlan? computeHybridPickPlan({
  required int total,
  required int unitsPerBox,
  int availableLoose = 0,
}) {
  if (unitsPerBox < 1 || total < 0) {
    return null;
  }
  final int totalI = total;
  final int upb = unitsPerBox;
  final int availLoose = availableLoose < 0 ? 0 : availableLoose;
  final int fullBoxes = totalI ~/ upb;
  final int looseNeeded = totalI % upb;
  final int looseFromStock =
      looseNeeded < availLoose ? looseNeeded : availLoose;
  final int looseDeficit = looseNeeded - looseFromStock;
  final int boxesToOpen =
      looseDeficit > 0 ? (looseDeficit + upb - 1) ~/ upb : 0;
  return HybridPickPlan(
    fullBoxes: fullBoxes,
    looseNeeded: looseNeeded,
    looseFromStock: looseFromStock,
    boxesToOpen: boxesToOpen,
    totalBoxesConsumed: fullBoxes + boxesToOpen,
  );
}

BoxQtyBreakdown? computeBoxQtyBreakdown({
  required double availableQty,
  required int unitsPerBox,
}) {
  if (unitsPerBox < 1) {
    return null;
  }
  final int totalUnits = availableQty.round();
  if (totalUnits < 0) {
    return null;
  }
  final int fullBoxes = totalUnits ~/ unitsPerBox;
  final int looseUnits = totalUnits % unitsPerBox;
  return BoxQtyBreakdown(
    fullBoxes: fullBoxes,
    looseUnits: looseUnits,
    totalUnits: totalUnits,
    unitsPerBox: unitsPerBox,
  );
}
