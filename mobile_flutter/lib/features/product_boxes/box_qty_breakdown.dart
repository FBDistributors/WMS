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

/// Umumiy yig'ish: har buyurtma qoldig'i bo'yicha quti/dona, keyin yig'indi.
({int boxCount, int looseQty})? computeConsolidatedBoxLoosePlan({
  required List<int> lineRemainders,
  required int unitsPerBox,
}) {
  if (unitsPerBox < 1) {
    final int looseTotal = lineRemainders
        .map((int q) => q < 0 ? 0 : q)
        .fold<int>(0, (int a, int b) => a + b);
    return (boxCount: 0, looseQty: looseTotal);
  }
  int boxes = 0;
  int loose = 0;
  for (final int q in lineRemainders) {
    final int rem = q < 0 ? 0 : q;
    if (rem <= 0) {
      continue;
    }
    boxes += rem ~/ unitsPerBox;
    loose += rem % unitsPerBox;
  }
  return (boxCount: boxes, looseQty: loose);
}

/// Har hujjat uchun qoldiq (bir nechta qator bo'lsa yig'iladi).
List<int> consolidatedRemaindersByDocument({
  required List<({String documentId, double qtyRequired, double qtyPicked})> lines,
}) {
  final Map<String, int> byDoc = <String, int>{};
  for (final ({String documentId, double qtyRequired, double qtyPicked}) line in lines) {
    final int rem = (line.qtyRequired - line.qtyPicked).round();
    if (rem <= 0) {
      continue;
    }
    byDoc[line.documentId] = (byDoc[line.documentId] ?? 0) + rem;
  }
  return byDoc.values.toList(growable: false);
}
