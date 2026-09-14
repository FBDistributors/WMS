/// Diller ombor qoldig'i sanovi — modellar.
///
/// Holatsiz: sanov (`DealerCount`) web'da yaratiladi, bir yoki bir necha xodim telefonda
/// uni ochib sanaydi. Telefondagi nusxa (`DealerSheetDraft`, sqflite) internetsiz ishlaydi;
/// sanalgan qatorlar "yuborilmagan" (`dirty`) bo'lib turadi va internet bo'lganda serverga
/// ketadi, serverdan esa boshqalar sanagani qo'shiladi.
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

/// Joy kodi — server bilan bir xil: bo'shliqlar qisqaradi, katta harf, 32 belgi.
String? normLocation(String? v) {
  final String s = (v ?? '').trim().split(RegExp(r'\s+')).where((String p) => p.isNotEmpty).join(' ').toUpperCase();
  if (s.isEmpty) {
    return null;
  }
  return s.length > 32 ? s.substring(0, 32) : s;
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
    this.locationCode,
    this.countedAt,
    this.countedByName,
  });

  final String id;
  final String? productId;
  final String? sku;
  final String? productName;
  final String scannedBarcode;
  /// null — sanalmagan qator.
  final double? qty;
  /// Ro'yxat to'ldirilgandagi Smartup soni.
  final double? snapshotQty;
  final String? locationCode;
  final String? countedAt;
  final String? countedByName;
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
        locationCode: json['location_code'] as String?,
        countedAt: json['counted_at'] as String?,
        countedByName: json['counted_by_name'] as String?,
        expiryDate: json['expiry_date'] as String?,
        seq: (json['seq'] as num?)?.toInt() ?? 0,
      );
}

class DealerCount {
  const DealerCount({
    required this.id,
    required this.dealerOrgId,
    required this.dealerName,
    required this.isActive,
    required this.createdAt,
    required this.totalUnits,
    required this.lines,
    this.sheetLines = 0,
    this.countedLines = 0,
    this.note,
  });

  final String id;
  final String dealerOrgId;
  final String? dealerName;
  /// Dillerning faol sanovi — telefonlarda ko'rinadi; yangisi yaratilsa false.
  final bool isActive;
  final String createdAt;
  final double totalUnits;
  final List<DealerCountLine> lines;
  /// Ro'yxatdagi jami qatorlar va haqiqatan sanalganlari ("45/693").
  final int sheetLines;
  final int countedLines;
  final String? note;

  factory DealerCount.fromJson(Map<String, Object?> json) {
    final Object? rawLines = json['lines'];
    return DealerCount(
      id: json['id']! as String,
      dealerOrgId: json['dealer_org_id']! as String,
      dealerName: json['dealer_name'] as String?,
      isActive: json['is_active'] != false,
      createdAt: (json['created_at'] as String?) ?? '',
      totalUnits: _num(json['total_units']),
      lines: rawLines is List
          ? rawLines
              .whereType<Map>()
              .map((Map m) => DealerCountLine.fromJson(Map<String, Object?>.from(m)))
              .toList(growable: false)
          : const <DealerCountLine>[],
      sheetLines: (json['sheet_lines'] as num?)?.toInt() ?? 0,
      countedLines: (json['counted_lines'] as num?)?.toInt() ?? 0,
      note: json['note'] as String?,
    );
  }
}

/// Sanaga oy boshi: `2027-03-15` → `2027-03-01`.
String monthStartIso(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-01';

// --- Telefondagi nusxa ---------------------------------------------------------

/// Nusxa qatori: serverdan kelgan (`lineId` bor) yoki telefonda qo'shilgan (hali yuborilmagan).
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
    this.locationCode,
    this.countedByName,
    this.dirty = false,
    this.version = 0,
  });

  final String key;
  String? lineId;
  final String? productId;
  final String? sku;
  final String? productName;
  final String barcode;
  final double? snapshotQty;
  /// null — hali sanalmagan; 0 — "dillerda yo'q".
  double? qty;
  String? expiryDate;
  String? locationCode;
  String? countedAt;
  String? countedByName;
  /// Telefonda o'zgartirilgan, serverga hali yetmagan.
  bool dirty;
  /// Har tahrirda oshadi: yuborish paytidagi holatdan keyin o'zgargan qator "yuborilgan" deb belgilanmasin.
  int version;

  bool get isCounted => qty != null;

  /// Mahsulot + muddat + joy — server bilan bir xil qator kaliti.
  String get identity => '${productId ?? 'raw:$barcode'}|${expiryDate ?? ''}|${locationCode ?? ''}';

  bool matches(String q) {
    final String s = q.trim().toLowerCase();
    if (s.isEmpty) {
      return true;
    }
    return (productName ?? '').toLowerCase().contains(s) ||
        (sku ?? '').toLowerCase().contains(s) ||
        barcode.toLowerCase().contains(s) ||
        (locationCode ?? '').toLowerCase().contains(s);
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
        'location_code': locationCode,
        'counted_at': countedAt,
        'counted_by_name': countedByName,
        'dirty': dirty,
        'version': version,
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
        locationCode: json['location_code'] as String?,
        countedAt: json['counted_at'] as String?,
        countedByName: json['counted_by_name'] as String?,
        // 1.0.47 gacha nusxalarda `dirty` yo'q: sanalgan, lekin yuborilmagan qatorlar edi.
        dirty: json['dirty'] as bool? ?? (json['qty'] != null && json['counted_at'] != null),
        version: (json['version'] as num?)?.toInt() ?? 0,
      );

  factory DealerSheetLine.fromServer(DealerCountLine l) => DealerSheetLine(
        key: 'srv-${l.id}',
        lineId: l.id,
        productId: l.productId,
        sku: l.sku,
        productName: l.productName,
        barcode: l.scannedBarcode,
        snapshotQty: l.snapshotQty,
        qty: l.qty,
        expiryDate: l.expiryDate,
        locationCode: l.locationCode,
        countedAt: l.countedAt,
        countedByName: l.countedByName,
      );

  /// `PUT /dealer-counts/{id}/counts` uchun yozuv.
  Map<String, Object?> toCountEntry() => <String, Object?>{
        if (lineId != null) 'line_id': lineId,
        if (productId != null) 'product_id': productId,
        'scanned_barcode': barcode,
        'qty': qty,
        if (expiryDate != null) 'expiry_date': expiryDate,
        if (locationCode != null) 'location_code': locationCode,
        if (countedAt != null) 'counted_at': countedAt,
      };
}

enum SheetFilter { uncounted, counted, all }

/// Serverdagi sanovning telefondagi nusxasi (sqflite, `kind: sheet`), internet shart emas.
class DealerSheetDraft {
  DealerSheetDraft({
    required this.countId,
    required this.dealerOrgId,
    required this.dealerName,
    required this.downloadedAt,
    required this.lines,
    this.ownerUserId,
    this.currentLocation,
  });

  static const String kind = 'sheet';
  static String storageKey(String countId) => 'sheet:$countId';

  final String countId;
  final String dealerOrgId;
  final String dealerName;
  String downloadedAt;
  List<DealerSheetLine> lines;

  /// Nusxani yuklab olgan xodim. Telefon bir necha kishida bo'lsa, boshqaning nusxasiga
  /// tegilmaydi. 1.0.46 gacha yuklangan nusxalarda yo'q (null — joriy xodimniki deb olinadi).
  final String? ownerUserId;

  /// Hozirgi joy (javon / zona): keyingi skanlar shu joyga yoziladi.
  String? currentLocation;

  bool belongsTo(String? userId) => ownerUserId == null || ownerUserId == userId;

  int get countedCount => lines.where((DealerSheetLine l) => l.isCounted).length;
  int get uncountedCount => lines.length - countedCount;
  int get pendingCount => lines.where((DealerSheetLine l) => l.dirty).length;
  double get countedUnits => lines.fold<double>(0, (double s, DealerSheetLine l) => s + (l.qty ?? 0));

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

  /// Skanerlangan tovar uchun qator (server `apply_counts` bilan bir xil tartibda):
  /// shu joydagi qator → ro'yxatdagi hali sanalmagan joysiz qator → null (yangi qator kerak).
  DealerSheetLine? lineForScan(bool Function(DealerSheetLine) isProduct, String? location) {
    final String? loc = normLocation(location);
    for (final DealerSheetLine l in lines) {
      if (isProduct(l) && l.locationCode == loc) {
        return l;
      }
    }
    for (final DealerSheetLine l in lines) {
      if (isProduct(l) && !l.isCounted && l.locationCode == null) {
        return l;
      }
    }
    return null;
  }

  /// Sanalgan qiymatni yozish: yuborilmagan bo'ladi, vaqti — hozir.
  void markCounted(DealerSheetLine l, {required double qty, required String? expiry, required String? location}) {
    l.qty = qty;
    l.expiryDate = expiry;
    l.locationCode = normLocation(location);
    l.countedAt = DateTime.now().toUtc().toIso8601String();
    l.countedByName = null;
    l.dirty = true;
    l.version += 1;
  }

  /// Serverga yuboriladigan qatorlar (faqat yuborilmaganlari) va ularning holati.
  ({List<Map<String, Object?>> entries, Map<String, int> versions}) pendingSnapshot() {
    final List<DealerSheetLine> p = lines.where((DealerSheetLine l) => l.dirty && l.isCounted).toList();
    return (
      entries: p.map((DealerSheetLine l) => l.toCountEntry()).toList(growable: false),
      versions: <String, int>{for (final DealerSheetLine l in p) l.key: l.version},
    );
  }

  /// Serverga yetgan qatorlar yuborilgan deb belgilanadi — yuborish paytida yana
  /// o'zgartirilganlari (versiya oshgan) yuborilmagan bo'lib qoladi.
  void markSynced(Map<String, int> versions) {
    for (final DealerSheetLine l in lines) {
      if (versions[l.key] == l.version) {
        l.dirty = false;
      }
    }
  }

  /// Serverdagi holat + telefondagi yuborilmaganlar. Boshqa xodimlar sanagani keladi,
  /// yuborilmagan o'z o'zgarishlari esa ustida qoladi (server qatoriga mahsulot+muddat+joy
  /// bo'yicha bog'lanadi, shunda ikki marta ko'rinmaydi).
  void mergeServer(DealerCount c) {
    final List<DealerSheetLine> fresh = c.lines.map(DealerSheetLine.fromServer).toList();
    final Map<String, int> byId = <String, int>{
      for (int i = 0; i < fresh.length; i++) fresh[i].lineId!: i,
    };
    final Map<String, int> byIdentity = <String, int>{
      for (int i = 0; i < fresh.length; i++) fresh[i].identity: i,
    };
    final List<DealerSheetLine> extra = <DealerSheetLine>[];
    for (final DealerSheetLine l in lines.where((DealerSheetLine l) => l.dirty)) {
      final int? i = (l.lineId != null ? byId[l.lineId] : null) ?? byIdentity[l.identity];
      if (i != null) {
        l.lineId ??= fresh[i].lineId;
        fresh[i] = l;
      } else if (l.lineId == null) {
        extra.add(l);
      }
      // lineId bor, lekin serverda yo'q (web'dan o'chirilgan qator) — yuborilmagani ham tashlanadi.
    }
    lines = <DealerSheetLine>[...fresh, ...extra];
    downloadedAt = DateTime.now().toUtc().toIso8601String();
  }

  /// Serverdan kelgan sanov → telefon nusxasi.
  factory DealerSheetDraft.fromCount(DealerCount c, {String? ownerUserId}) => DealerSheetDraft(
        countId: c.id,
        dealerOrgId: c.dealerOrgId,
        dealerName: c.dealerName ?? c.dealerOrgId,
        downloadedAt: DateTime.now().toUtc().toIso8601String(),
        ownerUserId: ownerUserId,
        lines: c.lines.map(DealerSheetLine.fromServer).toList(),
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'kind': kind,
        'count_id': countId,
        'dealer_org_id': dealerOrgId,
        'dealer_name': dealerName,
        'downloaded_at': downloadedAt,
        if (ownerUserId != null) 'owner_user_id': ownerUserId,
        if (currentLocation != null) 'current_location': currentLocation,
        'lines': lines.map((DealerSheetLine l) => l.toJson()).toList(growable: false),
      };

  factory DealerSheetDraft.fromJson(Map<String, Object?> json) {
    final Object? raw = json['lines'];
    return DealerSheetDraft(
      countId: json['count_id']! as String,
      dealerOrgId: json['dealer_org_id']! as String,
      dealerName: (json['dealer_name'] as String?) ?? (json['dealer_org_id']! as String),
      downloadedAt: (json['downloaded_at'] as String?) ?? '',
      ownerUserId: json['owner_user_id'] as String?,
      currentLocation: json['current_location'] as String?,
      lines: raw is List
          ? raw.whereType<Map>().map((Map m) => DealerSheetLine.fromJson(Map<String, Object?>.from(m))).toList()
          : <DealerSheetLine>[],
    );
  }
}
