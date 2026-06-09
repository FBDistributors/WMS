import '../data/picking_models.dart';

/// Skan natijasi (quti yoki dona).
class PickScanResolveResult {
  const PickScanResolveResult({
    required this.line,
    this.unitsPerScan = 1,
    this.isBoxScan = false,
  });

  final PickingLine line;
  final int unitsPerScan;
  final bool isBoxScan;
}

/// Skan/barcode qidiruvi — bir xil barcode bo'lgan product/action/gift qatorlari uchun.

bool productIdMatchesPickLine(String productId, PickingLine line) {
  final String pid = productId.trim();
  if (pid.isEmpty) {
    return false;
  }
  return line.productId != null && line.productId!.trim() == pid;
}

List<PickingLine> findAllLinesByProductId(List<PickingLine> lines, String productId) {
  return lines
      .where((PickingLine l) => productIdMatchesPickLine(productId, l))
      .toList(growable: false);
}

bool barcodeMatchesPickLine(String raw, PickingLine line) {
  final String q = raw.trim().toLowerCase();
  if (q.isEmpty) {
    return false;
  }
  if (line.barcode != null && line.barcode!.toLowerCase() == q) {
    return true;
  }
  if (line.sku != null && line.sku!.toLowerCase() == q) {
    return true;
  }
  return false;
}

/// `_groupLinesByProduct` bilan bir xil guruh kaliti.
String pickLineGroupKey(PickingLine l) {
  if (l.isVipExpiryInformational) {
    return 'vip_info:${l.id}';
  }
  final String src = (l.lineSource ?? 'product').trim();
  if (l.productId != null && l.productId!.isNotEmpty) {
    return 'id:${l.productId}:src:$src';
  }
  return '${l.productName}|${l.barcode ?? l.sku ?? ''}|src:$src';
}

List<PickingLine> findAllLinesByScan(List<PickingLine> lines, String raw) {
  return lines.where((PickingLine l) => barcodeMatchesPickLine(raw, l)).toList(growable: false);
}

List<PickingLine> membersOfSamePickCard(List<PickingLine> allLines, PickingLine anchor) {
  final String key = pickLineGroupKey(anchor);
  return allLines.where((PickingLine l) => pickLineGroupKey(l) == key).toList(growable: false);
}

bool isControllerPickGroupFullyVerified(
  List<PickingLine> allLines,
  PickingLine anchor,
  Set<String> verifiedLineIds,
) {
  return membersOfSamePickCard(allLines, anchor)
      .every((PickingLine l) => verifiedLineIds.contains(l.id));
}

/// Quti skani: mahsulot ID bo'yicha ochiq qator.
PickingLine? resolvePickerScanLineByProductId(List<PickingLine> lines, String productId) {
  final List<PickingLine> matches = findAllLinesByProductId(lines, productId);
  if (matches.isEmpty) {
    return null;
  }
  for (final PickingLine l in matches) {
    if (!l.isVipExpiryInformational && l.qtyPicked < l.qtyRequired) {
      return l;
    }
  }
  return matches.first;
}

/// Kontroller: mahsulot ID bo'yicha hali tekshirilmagan guruh.
PickingLine? resolveControllerScanLineByProductId(
  List<PickingLine> lines,
  String productId,
  Set<String> verifiedLineIds,
) {
  final List<PickingLine> matches = findAllLinesByProductId(lines, productId);
  if (matches.isEmpty) {
    return null;
  }
  for (final PickingLine l in matches) {
    if (!isControllerPickGroupFullyVerified(lines, l, verifiedLineIds)) {
      return l;
    }
  }
  return matches.first;
}

PickingLine? resolveScanLineInGroupByProductId(List<PickingLine> members, String productId) {
  for (final PickingLine l in members) {
    if (productIdMatchesPickLine(productId, l)) {
      return l;
    }
  }
  return null;
}

/// Terish: ochiq qatorni afzal tanlash (aksiya asosiydan keyin terilishi uchun).
PickingLine? resolvePickerScanLine(List<PickingLine> lines, String raw) {
  final List<PickingLine> matches = findAllLinesByScan(lines, raw);
  if (matches.isEmpty) {
    return null;
  }
  for (final PickingLine l in matches) {
    if (!l.isVipExpiryInformational && l.qtyPicked < l.qtyRequired) {
      return l;
    }
  }
  return matches.first;
}

/// Kontroller: hali tekshirilmagan guruhni afzal tanlash.
PickingLine? resolveControllerScanLine(
  List<PickingLine> lines,
  String raw,
  Set<String> verifiedLineIds,
) {
  final List<PickingLine> matches = findAllLinesByScan(lines, raw);
  if (matches.isEmpty) {
    return null;
  }
  for (final PickingLine l in matches) {
    if (!isControllerPickGroupFullyVerified(lines, l, verifiedLineIds)) {
      return l;
    }
  }
  return matches.first;
}

/// Sheet ichida: faqat joriy kartochka a'zolari orasidan qidirish.
PickingLine? resolveScanLineInGroup(List<PickingLine> members, String raw) {
  for (final PickingLine l in members) {
    if (barcodeMatchesPickLine(raw, l)) {
      return l;
    }
  }
  return null;
}

/// Repository `submitScan` (lineId yo'q): nom bo'yicha qidiruv ham qo'llab-quvvatlanadi.
PickingLine? resolveSubmitScanLine(
  List<PickingLine> lines,
  String barcode, {
  bool includeNameMatch = true,
}) {
  final String q = barcode.trim().toLowerCase();
  if (q.isEmpty) {
    return null;
  }

  PickingLine? firstMatch;
  for (final PickingLine l in lines) {
    final bool byBarcode = l.barcode != null && l.barcode!.toLowerCase() == q;
    final bool bySku = l.sku != null && l.sku!.toLowerCase() == q;
    final bool byName = includeNameMatch && l.productName.toLowerCase().contains(q);
    if (!byBarcode && !bySku && !byName) {
      continue;
    }
    firstMatch ??= l;
    if (!l.isVipExpiryInformational && l.qtyPicked < l.qtyRequired) {
      return l;
    }
  }
  return firstMatch;
}
