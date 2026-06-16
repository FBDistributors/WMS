/// Kirim qabul: quti soni + qutisiz dona → jami dona.
int? computeKirimReceiveTotal({
  required int boxCount,
  required int looseQty,
  required int? unitsPerBox,
}) {
  final int bc = boxCount < 0 ? 0 : boxCount;
  final int loose = looseQty < 0 ? 0 : looseQty;
  if (bc > 0 && (unitsPerBox == null || unitsPerBox < 1)) {
    return null;
  }
  final int boxUnits = bc > 0 && unitsPerBox != null ? bc * unitsPerBox : 0;
  final int total = boxUnits + loose;
  if (total < 1) {
    return null;
  }
  return total;
}
