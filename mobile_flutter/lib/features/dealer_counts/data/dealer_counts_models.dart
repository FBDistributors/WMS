/// Diller ombor qoldig'i sanovi — modellar.
///
/// Ro'yxat (`DealerCount`) faqat web'da yaratiladi; telefon uni oladi va
/// `DealerSheetDraft` nusxasida sanaydi. `DealerCountDraft` — 1.0.44 dan oldin
/// telefonda boshlangan bo'sh draftlar (o'tish davri, yangisi yaratilmaydi).
library;

double _num(Object? v) {
  if (v is num) {
    return v.toDouble();
  }
  if (v is String) {
    return double.tryParse(v) ?? 0;
  }
  return 0;
}

class DealerCountLine {
  const DealerCountLine({
    required this.id,
    required this.productId,
    required this.sku,
    required this.productName,
    required this.scannedBarcode,
    required this.qty,
    required this.expiryDate,
    required this.seq,
    this.snapshotQty,
    this.countedAt,
  });

  final String id;
  final String? productId;
  final String? sku;
  final String? productName;
  final String scannedBarcode;
  /// null — tayyor ro'yxatdagi hali sanalmagan qator.
  final double? qty;
  /// Ro'yxat to'ldirilgandagi Smartup soni.
  final double? snapshotQty;
  /// Xodim haqiqatan sanagan payt; "0 deb hisobla" qatorlarida null.
  final String? countedAt;
  final String? expiryDate;
  final int seq;

  factory DealerCountLine.fromJson(Map<String, Object?> json) => DealerCountLine(
        id: json['id']! as String,
        productId: json['product_id'] as String?,
        sku: json['sku'] as String?,
        productName: json['product_name'] as String?,
        scannedBarcode: (json['scanned_barcode'] as String?) ?? '',
        qty: json['qty'] == null ? null : _num(json['qty']),
        snapshotQty: json['snapshot_qty'] == null ? null : _num(json['snapshot_qty']),
        countedAt: json['counted_at'] as String?,
        expiryDate: json['expiry_date'] as String?,
        seq: (json['seq'] as num?)?.toInt() ?? 0,
      );
}

class DealerCount {
  const DealerCount({
    required this.id,
    required this.clientUuid,
    required this.dealerOrgId,
    required this.dealerName,
    required this.countedByName,
    required this.status,
    required this.startedAt,
    required this.submittedAt,
    required this.note,
    required this.linesCount,
    required this.totalUnits,
    required this.warning,
    required this.lines,
    this.sheetLines = 0,
    this.countedLines = 0,
    this.assignedToUserId,
    this.assignedToName,
    this.source = 'mobile',
  });

  final String id;
  final String clientUuid;
  final String dealerOrgId;
  final String? dealerName;
  final String? countedByName;
  final String status;
  final String startedAt;
  final String? submittedAt;
  final String? note;
  final int linesCount;
  final double totalUnits;
  final String? warning;
  final List<DealerCountLine> lines;
  /// Tayyor ro'yxat: jami qatorlar va haqiqatan sanalganlari ("45/693").
  final int sheetLines;
  final int countedLines;
  final String? assignedToUserId;
  final String? assignedToName;
  final String source;

  bool get isSheetOpen => status == 'draft' || status == 'in_progress';

  factory DealerCount.fromJson(Map<String, Object?> json) {
    final Object? rawLines = json['lines'];
    return DealerCount(
      id: json['id']! as String,
      clientUuid: json['client_uuid']! as String,
      dealerOrgId: json['dealer_org_id']! as String,
      dealerName: json['dealer_name'] as String?,
      countedByName: json['counted_by_name'] as String?,
      status: (json['status'] as String?) ?? 'draft',
      startedAt: (json['started_at'] as String?) ?? '',
      submittedAt: json['submitted_at'] as String?,
      note: json['note'] as String?,
      linesCount: (json['lines_count'] as num?)?.toInt() ?? 0,
      totalUnits: _num(json['total_units']),
      warning: json['warning'] as String?,
      lines: rawLines is List
          ? rawLines
              .whereType<Map>()
              .map((Map m) => DealerCountLine.fromJson(Map<String, Object?>.from(m)))
              .toList(growable: false)
          : const <DealerCountLine>[],
      sheetLines: (json['sheet_lines'] as num?)?.toInt() ?? 0,
      countedLines: (json['counted_lines'] as num?)?.toInt() ?? 0,
      assignedToUserId: json['assigned_to_user_id'] as String?,
      assignedToName: json['assigned_to_name'] as String?,
      source: (json['source'] as String?) ?? 'mobile',
    );
  }
}

/// Telefondagi draft qatori. `productId` null — tanilmagan skan (internet yo'q
/// yoki mahsulot bazada yo'q): xom kod saqlanadi, server yuborishda resolve qiladi.
class DealerCountDraftLine {
  DealerCountDraftLine({
    required this.key,
    required this.productId,
    required this.productName,
    required this.scannedBarcode,
    required this.qty,
    required this.expiryDate,
    required this.scannedAt,
  });

  final String key;
  final String? productId;
  final String? productName;
  final String scannedBarcode;
  double qty;
  /// `YYYY-MM-01` yoki null.
  String? expiryDate;
  final String scannedAt;

  bool get isUnknown => productId == null;

  Map<String, Object?> toJson() => <String, Object?>{
        'key': key,
        'product_id': productId,
        'product_name': productName,
        'scanned_barcode': scannedBarcode,
        'qty': qty,
        'expiry_date': expiryDate,
        'scanned_at': scannedAt,
      };

  factory DealerCountDraftLine.fromJson(Map<String, Object?> json) => DealerCountDraftLine(
        key: json['key']! as String,
        productId: json['product_id'] as String?,
        productName: json['product_name'] as String?,
        scannedBarcode: (json['scanned_barcode'] as String?) ?? '',
        qty: _num(json['qty']),
        expiryDate: json['expiry_date'] as String?,
        scannedAt: (json['scanned_at'] as String?) ?? '',
      );

  /// Serverga yuboriladigan shakl.
  Map<String, Object?> toApiJson() => <String, Object?>{
        if (productId != null) 'product_id': productId,
        'scanned_barcode': scannedBarcode,
        'qty': qty,
        if (expiryDate != null) 'expiry_date': expiryDate,
        if (scannedAt.isNotEmpty) 'scanned_at': scannedAt,
      };
}

class DealerCountDraft {
  DealerCountDraft({
    required this.clientUuid,
    required this.dealerOrgId,
    required this.dealerName,
    required this.startedAt,
    required this.lines,
    this.note,
  });

  final String clientUuid;
  final String dealerOrgId;
  final String dealerName;
  final String startedAt;
  final List<DealerCountDraftLine> lines;
  String? note;

  double get totalUnits => lines.fold<double>(0, (double s, DealerCountDraftLine l) => s + l.qty);

  /// Skanni qo'shish: bir xil mahsulot + bir xil muddat bo'lsa miqdor qo'shiladi;
  /// tanilmagan skan har doim yangi qator (unga qo'shib bo'lmaydi).
  DealerCountDraftLine addScan({
    required String key,
    required String? productId,
    required String? productName,
    required String scannedBarcode,
    required double qty,
    required String? expiryDate,
    required String scannedAt,
  }) {
    if (productId != null) {
      for (final DealerCountDraftLine l in lines) {
        if (l.productId == productId && l.expiryDate == expiryDate) {
          l.qty += qty;
          return l;
        }
      }
    }
    final DealerCountDraftLine line = DealerCountDraftLine(
      key: key,
      productId: productId,
      productName: productName,
      scannedBarcode: scannedBarcode,
      qty: qty,
      expiryDate: expiryDate,
      scannedAt: scannedAt,
    );
    lines.add(line);
    return line;
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'client_uuid': clientUuid,
        'dealer_org_id': dealerOrgId,
        'dealer_name': dealerName,
        'started_at': startedAt,
        'note': note,
        'lines': lines.map((DealerCountDraftLine l) => l.toJson()).toList(growable: false),
      };

  factory DealerCountDraft.fromJson(Map<String, Object?> json) {
    final Object? raw = json['lines'];
    return DealerCountDraft(
      clientUuid: json['client_uuid']! as String,
      dealerOrgId: json['dealer_org_id']! as String,
      dealerName: (json['dealer_name'] as String?) ?? (json['dealer_org_id']! as String),
      startedAt: (json['started_at'] as String?) ?? '',
      note: json['note'] as String?,
      lines: raw is List
          ? raw
              .whereType<Map>()
              .map((Map m) => DealerCountDraftLine.fromJson(Map<String, Object?>.from(m)))
              .toList()
          : <DealerCountDraftLine>[],
    );
  }

  Map<String, Object?> toApiJson({required bool submit}) => <String, Object?>{
        'client_uuid': clientUuid,
        'dealer_org_id': dealerOrgId,
        'started_at': startedAt,
        if (note != null && note!.trim().isNotEmpty) 'note': note!.trim(),
        'submit': submit,
        'lines': lines.map((DealerCountDraftLine l) => l.toApiJson()).toList(growable: false),
      };
}

/// Sanaga oy boshi: `2027-03-15` → `2027-03-01`.
String monthStartIso(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-01';

// --- Tayyor ro'yxat (ведомость) — telefondagi nusxa ---------------------------

/// Ro'yxat qatori: serverdan kelgan (`lineId` bor) yoki telefonda qo'shilgan.
class DealerSheetLine {
  DealerSheetLine({
    required this.key,
    required this.lineId,
    required this.productId,
    required this.sku,
    required this.productName,
    required this.barcode,
    required this.snapshotQty,
    required this.qty,
    required this.expiryDate,
    required this.countedAt,
    this.added = false,
  });

  final String key;
  final String? lineId;
  final String? productId;
  final String? sku;
  final String? productName;
  final String barcode;
  final double? snapshotQty;
  /// null — hali sanalmagan; 0 — "dillerda yo'q".
  double? qty;
  String? expiryDate;
  String? countedAt;
  /// Ro'yxatda yo'q edi — javonda topilib qo'shildi.
  final bool added;

  bool get isCounted => qty != null;

  bool matches(String q) {
    final String s = q.trim().toLowerCase();
    if (s.isEmpty) {
      return true;
    }
    return (productName ?? '').toLowerCase().contains(s) ||
        (sku ?? '').toLowerCase().contains(s) ||
        barcode.toLowerCase().contains(s);
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'key': key,
        'line_id': lineId,
        'product_id': productId,
        'sku': sku,
        'product_name': productName,
        'barcode': barcode,
        'snapshot_qty': snapshotQty,
        'qty': qty,
        'expiry_date': expiryDate,
        'counted_at': countedAt,
        'added': added,
      };

  factory DealerSheetLine.fromJson(Map<String, Object?> json) => DealerSheetLine(
        key: json['key']! as String,
        lineId: json['line_id'] as String?,
        productId: json['product_id'] as String?,
        sku: json['sku'] as String?,
        productName: json['product_name'] as String?,
        barcode: (json['barcode'] as String?) ?? '',
        snapshotQty: json['snapshot_qty'] == null ? null : _num(json['snapshot_qty']),
        qty: json['qty'] == null ? null : _num(json['qty']),
        expiryDate: json['expiry_date'] as String?,
        countedAt: json['counted_at'] as String?,
        added: json['added'] == true,
      );

  /// `PUT /dealer-counts/{id}/counts` uchun yozuv (faqat sanalganlar).
  Map<String, Object?> toCountEntry() => <String, Object?>{
        if (lineId != null) 'line_id': lineId,
        if (productId != null) 'product_id': productId,
        'scanned_barcode': barcode,
        'qty': qty,
        if (expiryDate != null) 'expiry_date': expiryDate,
        if (countedAt != null) 'scanned_at': countedAt,
      };
}

enum SheetFilter { uncounted, counted, all }

/// Serverdan olingan ro'yxatning telefondagi nusxasi. Sanov tugaguncha shu yerda
/// yashaydi (sqflite, `kind: sheet`), internet shart emas.
class DealerSheetDraft {
  DealerSheetDraft({
    required this.countId,
    required this.dealerOrgId,
    required this.dealerName,
    required this.downloadedAt,
    required this.lines,
  });

  static const String kind = 'sheet';
  static String storageKey(String countId) => 'sheet:$countId';

  final String countId;
  final String dealerOrgId;
  final String dealerName;
  final String downloadedAt;
  final List<DealerSheetLine> lines;

  int get countedCount => lines.where((DealerSheetLine l) => l.isCounted).length;
  int get uncountedCount => lines.length - countedCount;
  double get countedUnits =>
      lines.fold<double>(0, (double s, DealerSheetLine l) => s + (l.qty ?? 0));

  List<DealerSheetLine> filtered(SheetFilter f, String query) {
    return lines.where((DealerSheetLine l) {
      if (f == SheetFilter.uncounted && l.isCounted) {
        return false;
      }
      if (f == SheetFilter.counted && !l.isCounted) {
        return false;
      }
      return l.matches(query);
    }).toList(growable: false);
  }

  DealerSheetLine? findByProduct(String productId) {
    for (final DealerSheetLine l in lines) {
      if (l.productId == productId) {
        return l;
      }
    }
    return null;
  }

  /// Serverdan kelgan sanov → telefon nusxasi.
  factory DealerSheetDraft.fromCount(DealerCount c) => DealerSheetDraft(
        countId: c.id,
        dealerOrgId: c.dealerOrgId,
        dealerName: c.dealerName ?? c.dealerOrgId,
        downloadedAt: DateTime.now().toUtc().toIso8601String(),
        lines: c.lines
            .map(
              (DealerCountLine l) => DealerSheetLine(
                key: 'srv-${l.id}',
                lineId: l.id,
                productId: l.productId,
                sku: l.sku,
                productName: l.productName,
                barcode: l.scannedBarcode,
                snapshotQty: l.snapshotQty,
                qty: l.qty,
                expiryDate: l.expiryDate,
                countedAt: l.countedAt,
              ),
            )
            .toList(),
      );

  List<Map<String, Object?>> countEntries() => lines
      .where((DealerSheetLine l) => l.isCounted)
      .map((DealerSheetLine l) => l.toCountEntry())
      .toList(growable: false);

  Map<String, Object?> toJson() => <String, Object?>{
        'kind': kind,
        'count_id': countId,
        'dealer_org_id': dealerOrgId,
        'dealer_name': dealerName,
        'downloaded_at': downloadedAt,
        'lines': lines.map((DealerSheetLine l) => l.toJson()).toList(growable: false),
      };

  factory DealerSheetDraft.fromJson(Map<String, Object?> json) {
    final Object? raw = json['lines'];
    return DealerSheetDraft(
      countId: json['count_id']! as String,
      dealerOrgId: json['dealer_org_id']! as String,
      dealerName: (json['dealer_name'] as String?) ?? (json['dealer_org_id']! as String),
      downloadedAt: (json['downloaded_at'] as String?) ?? '',
      lines: raw is List
          ? raw.whereType<Map>().map((Map m) => DealerSheetLine.fromJson(Map<String, Object?>.from(m))).toList()
          : <DealerSheetLine>[],
    );
  }
}
