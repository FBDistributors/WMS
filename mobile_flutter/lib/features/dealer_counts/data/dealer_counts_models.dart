/// Diller ombor qoldig'i sanovi — modellar.
///
/// Server hujjati (`DealerCount`) va telefondagi draft (`DealerCountDraft`)
/// alohida: draft yuborilguncha faqat telefonda yashaydi, server esa uni
/// `client_uuid` bo'yicha bir marta qabul qiladi.
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

class Dealer {
  const Dealer({required this.orgId, required this.name});

  final String orgId;
  final String name;

  factory Dealer.fromJson(Map<String, Object?> json) => Dealer(
        orgId: json['org_id']! as String,
        name: (json['name'] as String?) ?? (json['org_id']! as String),
      );
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
  });

  final String id;
  final String? productId;
  final String? sku;
  final String? productName;
  final String scannedBarcode;
  final double qty;
  final String? expiryDate;
  final int seq;

  factory DealerCountLine.fromJson(Map<String, Object?> json) => DealerCountLine(
        id: json['id']! as String,
        productId: json['product_id'] as String?,
        sku: json['sku'] as String?,
        productName: json['product_name'] as String?,
        scannedBarcode: (json['scanned_barcode'] as String?) ?? '',
        qty: _num(json['qty']),
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
