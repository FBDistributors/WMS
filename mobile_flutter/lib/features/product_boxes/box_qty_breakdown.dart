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
