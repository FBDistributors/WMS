/// Diller ombor qoldig'i sanovi — modellar.
///
/// Holatsiz: sanov (`DealerCount`) web'da yaratiladi, bir yoki bir necha xodim telefonda
/// uni ochib sanaydi. Telefondagi nusxa (`DealerSheetDraft`, sqflite) internetsiz ishlaydi.
/// Har kiritish (`PendingOp`: jami / qayta skanda qo'shish / qo'shishni bekor qilish) o'z
/// `op_id`si bilan navbatda turadi va internet bo'lganda serverga ketadi — server bir
/// kiritishni bir marta qo'llaydi, qo'shishni esa joriy songa qo'shadi (ikki xodim bir qatorga
/// qo'shsa ham hech biri yo'qolmaydi). Serverdan boshqalar sanagani qo'shiladi.
library;

import 'package:uuid/uuid.dart';

double _num(Object? v) {
  if (v is num) {
    return v.toDouble();
  }
  if (v is String) {
    return double.tryParse(v) ?? 0;
  }
  return 0;
}

/// 12.0 → "12", 1.5 → "1.5".
String fmtQty(double v) => v == v.roundToDouble() ? v.toInt().toString() : v.toString();

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
    this.entriesBrief,
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
  /// Oxirgi jamidan beri kiritishlar ("12 + 5"); bitta kiritish bo'lsa null.
  final String? entriesBrief;
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
        entriesBrief: json['entries_brief'] as String?,
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

/// Serverga hali yetmagan bitta kiritish.
class PendingOp {
  PendingOp({required this.opId, required this.mode, required this.qty, required this.countedAt, this.undoOpId});

  final String opId;
  /// set — jami (birinchi sanash / tuzatish); add — qayta skanda qo'shish; undo — qo'shishni bekor qilish.
  final String mode;
  /// set: jami; add: qo'shilgan son; undo: bekor qilinayotgan qo'shish soni (faqat ko'rsatish uchun).
  final double qty;
  final String countedAt;
  final String? undoOpId;

  Map<String, Object?> toJson() => <String, Object?>{
        'op_id': opId,
        'mode': mode,
        'qty': qty,
        'counted_at': countedAt,
        if (undoOpId != null) 'undo_op_id': undoOpId,
      };

  factory PendingOp.fromJson(Map<String, Object?> j) => PendingOp(
        opId: j['op_id']! as String,
        mode: (j['mode'] as String?) ?? 'set',
        qty: _num(j['qty']),
        countedAt: (j['counted_at'] as String?) ?? '',
        undoOpId: j['undo_op_id'] as String?,
      );
}

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
    required double? qty,
    required this.expiryDate,
    required this.countedAt,
    this.locationCode,
    this.countedByName,
    this.entriesBrief,
    List<PendingOp>? pending,
  })  : baseQty = qty,
        pending = pending ?? <PendingOp>[] {
    _recompute();
  }

  final String key;
  String? lineId;
  final String? productId;
  final String? sku;
  final String? productName;
  final String barcode;
  final double? snapshotQty;
  /// Serverdagi son (oxirgi yangilanishda).
  double? baseQty;
  /// Ko'rinadigan son = serverdagi + navbatdagi kiritishlar. null — hali sanalmagan; 0 — "dillerda yo'q".
  double? qty;
  String? expiryDate;
  String? locationCode;
  String? countedAt;
  String? countedByName;
  String? entriesBrief;
  /// Serverga hali yetmagan kiritishlar (tartib bilan).
  List<PendingOp> pending;

  bool get isCounted => qty != null;
  bool get dirty => pending.isNotEmpty;

  void _recompute() {
    double? v = baseQty;
    for (final PendingOp op in pending) {
      switch (op.mode) {
        case 'set':
          v = op.qty;
        case 'add':
          v = (v ?? 0) + op.qty;
        case 'undo':
          final double left = (v ?? 0) - op.qty;
          v = left > 0 ? left : 0;
      }
    }
    qty = v;
  }

  /// Ko'rinish: "12 + 5" — oxirgi jamidan beri qo'shishlar (server + telefondagi navbat).
  String? get breakdown {
    final List<String> parts = <String>[];
    final String? brief = entriesBrief;
    if (brief != null && brief.contains('+')) {
      parts.addAll(brief.split('+').map((String p) => p.trim()));
    } else if (baseQty != null) {
      parts.add(fmtQty(baseQty!));
    }
    for (final PendingOp op in pending) {
      switch (op.mode) {
        case 'set':
          parts
            ..clear()
            ..add(fmtQty(op.qty));
        case 'add':
          parts.add(fmtQty(op.qty));
        case 'undo':
          if (parts.length > 1) {
            parts.removeLast();
          }
      }
    }
    return parts.length > 1 ? parts.join(' + ') : null;
  }

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
        'base_qty': baseQty,
        'expiry_date': expiryDate,
        'location_code': locationCode,
        'counted_at': countedAt,
        'counted_by_name': countedByName,
        'entries_brief': entriesBrief,
        'pending': pending.map((PendingOp o) => o.toJson()).toList(growable: false),
      };

  factory DealerSheetLine.fromJson(Map<String, Object?> json) {
    final Object? rawPending = json['pending'];
    List<PendingOp> pending = rawPending is List
        ? rawPending.whereType<Map>().map((Map m) => PendingOp.fromJson(Map<String, Object?>.from(m))).toList()
        : <PendingOp>[];
    double? base = json.containsKey('base_qty')
        ? (json['base_qty'] == null ? null : _num(json['base_qty']))
        : (json['qty'] == null ? null : _num(json['qty']));
    // 1.0.48 gacha nusxa: `dirty` — sanalgan, yuborilmagan jami. Navbatga "jami" kiritishi bo'lib o'tadi.
    if (rawPending == null && json['dirty'] == true && base != null) {
      pending = <PendingOp>[
        PendingOp(
          opId: const Uuid().v4(),
          mode: 'set',
          qty: base,
          countedAt: (json['counted_at'] as String?) ?? DateTime.now().toUtc().toIso8601String(),
        ),
      ];
      base = null;
    }
    return DealerSheetLine(
      key: json['key']! as String,
      lineId: json['line_id'] as String?,
      productId: json['product_id'] as String?,
      sku: json['sku'] as String?,
      productName: json['product_name'] as String?,
      barcode: (json['barcode'] as String?) ?? '',
      snapshotQty: json['snapshot_qty'] == null ? null : _num(json['snapshot_qty']),
      qty: base,
      expiryDate: json['expiry_date'] as String?,
      locationCode: json['location_code'] as String?,
      countedAt: json['counted_at'] as String?,
      countedByName: json['counted_by_name'] as String?,
      entriesBrief: json['entries_brief'] as String?,
      pending: pending,
    );
  }

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
        entriesBrief: l.entriesBrief,
      );

  /// `PUT /dealer-counts/{id}/counts` uchun yozuvlar — navbatdagi har kiritish alohida.
  List<Map<String, Object?>> toCountEntries() => pending
      .map(
        (PendingOp op) => <String, Object?>{
          'op_id': op.opId,
          'mode': op.mode,
          if (op.mode == 'undo') 'undo_op_id': op.undoOpId else 'qty': op.qty,
          if (lineId != null) 'line_id': lineId,
          if (productId != null) 'product_id': productId,
          'scanned_barcode': barcode,
          if (expiryDate != null) 'expiry_date': expiryDate,
          if (locationCode != null) 'location_code': locationCode,
          'counted_at': op.countedAt,
        },
      )
      .toList(growable: false);
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
  /// Yuborilmagan kiritishi bor qatorlar soni.
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

  /// Kiritish: `set` — jami (birinchi sanash / tuzatish), `add` — ustiga qo'shish (qayta skan).
  PendingOp addOp(
    DealerSheetLine l, {
    required String mode,
    required double qty,
    required String? expiry,
    required String? location,
  }) {
    final String now = DateTime.now().toUtc().toIso8601String();
    final PendingOp op = PendingOp(opId: const Uuid().v4(), mode: mode, qty: qty, countedAt: now);
    l.pending.add(op);
    l.expiryDate = expiry;
    l.locationCode = normLocation(location);
    l.countedAt = now;
    l.countedByName = null;
    l._recompute();
    return op;
  }

  /// Qo'shishni bekor qilish: hali yuborilmagan bo'lsa — navbatdan olinadi; yuborilgan bo'lsa —
  /// serverga "bekor qilish" kiritishi ketadi (server aynan shu qo'shishni ayiradi).
  void undoAdd(DealerSheetLine l, PendingOp add) {
    if (l.pending.remove(add)) {
      l._recompute();
      if (l.lineId == null && l.pending.isEmpty && l.baseQty == null) {
        lines.remove(l);
      }
      return;
    }
    l.pending.add(
      PendingOp(
        opId: const Uuid().v4(),
        mode: 'undo',
        qty: add.qty,
        undoOpId: add.opId,
        countedAt: DateTime.now().toUtc().toIso8601String(),
      ),
    );
    l._recompute();
  }

  /// Serverga yuboriladigan kiritishlar va ularning id lari.
  ({List<Map<String, Object?>> entries, Set<String> opIds}) pendingSnapshot() {
    final List<Map<String, Object?>> entries = <Map<String, Object?>>[];
    final Set<String> ids = <String>{};
    for (final DealerSheetLine l in lines) {
      if (l.dirty) {
        entries.addAll(l.toCountEntries());
        ids.addAll(l.pending.map((PendingOp o) => o.opId));
      }
    }
    return (entries: entries, opIds: ids);
  }

  /// Server qabul qilgan kiritishlar navbatdan olinadi (yuborish paytida qo'shilganlari qoladi).
  void markSynced(Set<String> opIds) {
    for (final DealerSheetLine l in lines) {
      l.pending.removeWhere((PendingOp o) => opIds.contains(o.opId));
    }
  }

  /// Serverdagi holat + telefondagi yuborilmagan kiritishlar. Boshqa xodimlar sanagani keladi,
  /// navbatdagilar ustiga qo'llanadi (server qatoriga mahsulot+muddat+joy bo'yicha bog'lanadi,
  /// shunda ikki marta ko'rinmaydi).
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
        final DealerSheetLine srv = fresh[i];
        l
          ..lineId = srv.lineId
          ..baseQty = srv.baseQty
          ..countedByName = srv.countedByName
          ..entriesBrief = srv.entriesBrief;
        l._recompute();
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
