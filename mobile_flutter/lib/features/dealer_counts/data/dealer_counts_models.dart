/// Diller ombor qoldig'i sanovi — modellar.
///
/// Onlayn (inventarizatsiya kabi): sanov (`DealerCount`) web'da yaratiladi, xodimlar telefonda
/// uni ochib sanaydi. Telefonda hech narsa saqlanmaydi — sanov ekran xotirasida (`DealerSheet`),
/// har kiritish darhol serverga ketadi, javobdagi o'zgargan qatorlar ekranga qo'llanadi.
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
  /// null — sanalmagan qator; 0 — "dillerda yo'q".
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

  bool get isCounted => qty != null;

  bool matches(String q) {
    final String s = q.trim().toLowerCase();
    if (s.isEmpty) {
      return true;
    }
    return (productName ?? '').toLowerCase().contains(s) ||
        (sku ?? '').toLowerCase().contains(s) ||
        scannedBarcode.toLowerCase().contains(s) ||
        (locationCode ?? '').toLowerCase().contains(s);
  }

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

List<DealerCountLine> _linesOf(Object? raw) => raw is List
    ? raw.whereType<Map>().map((Map m) => DealerCountLine.fromJson(Map<String, Object?>.from(m))).toList(growable: false)
    : const <DealerCountLine>[];

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
  /// To'liq yuklashda — hamma qator; saqlash javobida (`lines=changed`) — faqat o'zgarganlar.
  final List<DealerCountLine> lines;
  /// Ro'yxatdagi jami qatorlar va haqiqatan sanalganlari ("45/693").
  final int sheetLines;
  final int countedLines;
  final String? note;

  factory DealerCount.fromJson(Map<String, Object?> json) => DealerCount(
        id: json['id']! as String,
        dealerOrgId: json['dealer_org_id']! as String,
        dealerName: json['dealer_name'] as String?,
        isActive: json['is_active'] != false,
        createdAt: (json['created_at'] as String?) ?? '',
        totalUnits: _num(json['total_units']),
        lines: _linesOf(json['lines']),
        sheetLines: (json['sheet_lines'] as num?)?.toInt() ?? 0,
        countedLines: (json['counted_lines'] as num?)?.toInt() ?? 0,
        note: json['note'] as String?,
      );
}

/// `GET /dealer-counts/{id}/lines?changed_since=` javobi.
class DealerChangedLines {
  const DealerChangedLines({
    required this.id,
    required this.dealerName,
    required this.isActive,
    required this.sheetLines,
    required this.countedLines,
    required this.totalUnits,
    required this.serverTime,
    required this.lines,
  });

  final String id;
  final String dealerName;
  final bool isActive;
  final int sheetLines;
  final int countedLines;
  final double totalUnits;
  /// Keyingi so'rov uchun `changed_since`.
  final String serverTime;
  final List<DealerCountLine> lines;

  factory DealerChangedLines.fromJson(Map<String, Object?> json) => DealerChangedLines(
        id: (json['id'] as String?) ?? '',
        dealerName: (json['dealer_name'] as String?) ?? (json['dealer_org_id'] as String?) ?? '',
        isActive: json['is_active'] != false,
        sheetLines: (json['sheet_lines'] as num?)?.toInt() ?? 0,
        countedLines: (json['counted_lines'] as num?)?.toInt() ?? 0,
        totalUnits: _num(json['total_units']),
        serverTime: (json['server_time'] as String?) ?? '',
        lines: _linesOf(json['lines']),
      );
}

/// Sanaga oy boshi: `2027-03-15` → `2027-03-01`.
String monthStartIso(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-01';

enum SheetFilter { uncounted, counted, all }

/// Ochiq sanov — faqat ekran xotirasida. Serverdan kelgan qatorlar (to'liq yoki o'zgarganlar)
/// id bo'yicha almashtiriladi/qo'shiladi.
class DealerSheet {
  DealerSheet({required this.countId, required this.dealerName, required List<DealerCountLine> lines})
      : lines = List<DealerCountLine>.of(lines);

  factory DealerSheet.fromCount(DealerCount c) =>
      DealerSheet(countId: c.id, dealerName: c.dealerName ?? c.dealerOrgId, lines: c.lines);

  final String countId;
  final String dealerName;
  List<DealerCountLine> lines;
  /// Serverdagi jami qatorlar soni — ekrandagidan farq qilsa (web'da qator o'chirilgan) to'liq qayta yuklanadi.
  int? serverSheetLines;

  int get countedCount => lines.where((DealerCountLine l) => l.isCounted).length;
  int get uncountedCount => lines.length - countedCount;
  double get countedUnits => lines.fold<double>(0, (double s, DealerCountLine l) => s + (l.qty ?? 0));
  bool get outOfSync => serverSheetLines != null && serverSheetLines != lines.length;

  /// Serverdan kelgan qatorlar: borlari almashtiriladi, yangilari oxiriga qo'shiladi.
  void applyLines(Iterable<DealerCountLine> changed, {int? sheetLines}) {
    final Map<String, int> index = <String, int>{for (int i = 0; i < lines.length; i++) lines[i].id: i};
    for (final DealerCountLine l in changed) {
      final int? i = index[l.id];
      if (i != null) {
        lines[i] = l;
      } else {
        index[l.id] = lines.length;
        lines.add(l);
      }
    }
    if (sheetLines != null) {
      serverSheetLines = sheetLines;
    }
  }

  List<DealerCountLine> filtered(SheetFilter f, String query) {
    return lines.where((DealerCountLine l) {
      if (f == SheetFilter.uncounted && l.isCounted) {
        return false;
      }
      if (f == SheetFilter.counted && !l.isCounted) {
        return false;
      }
      return l.matches(query);
    }).toList(growable: false);
  }

  /// Skanerlangan tovar uchun qator (server `apply_counts` bilan bir xil tartibda):
  /// shu joydagi qator → ro'yxatdagi hali sanalmagan joysiz qator → null (server yangi qator ochadi).
  DealerCountLine? lineForScan(bool Function(DealerCountLine) isProduct, String? location) {
    final String? loc = normLocation(location);
    for (final DealerCountLine l in lines) {
      if (isProduct(l) && l.locationCode == loc) {
        return l;
      }
    }
    for (final DealerCountLine l in lines) {
      if (isProduct(l) && !l.isCounted && l.locationCode == null) {
        return l;
      }
    }
    return null;
  }
}

/// Serverga bitta kiritish (`PUT /dealer-counts/{id}/counts`). `opId` — qayta urinishda o'zgarmaydi,
/// server bir kiritishni bir marta qo'llaydi.
Map<String, Object?> dealerCountEntry({
  required String opId,
  required String mode,
  double? qty,
  String? undoOpId,
  String? lineId,
  String? productId,
  String barcode = '',
  String? expiryDate,
  String? locationCode,
}) =>
    <String, Object?>{
      'op_id': opId,
      'mode': mode,
      if (qty != null) 'qty': qty,
      if (undoOpId != null) 'undo_op_id': undoOpId,
      if (lineId != null) 'line_id': lineId,
      if (productId != null) 'product_id': productId,
      'scanned_barcode': barcode,
      if (expiryDate != null) 'expiry_date': expiryDate,
      if (locationCode != null) 'location_code': locationCode,
      'counted_at': DateTime.now().toUtc().toIso8601String(),
    };

/// 1.0.49 gacha telefonda saqlangan nusxa (sqflite) dan yuborilmagan kiritishlar — onlayn
/// versiyaga o'tishda bir marta yuboriladi. Qaytaradi: (sanov id, kiritishlar) yoki null (nusxa emas).
({String countId, List<Map<String, Object?>> entries})? legacyDraftEntries(Map<String, Object?> row) {
  if (row['kind'] != 'sheet' || row['count_id'] is! String) {
    return null;
  }
  final List<Map<String, Object?>> out = <Map<String, Object?>>[];
  final Object? rawLines = row['lines'];
  for (final Map<dynamic, dynamic> m in rawLines is List ? rawLines.whereType<Map>() : const <Map>[]) {
    final Map<String, Object?> l = Map<String, Object?>.from(m);
    final Map<String, Object?> base = <String, Object?>{
      if (l['line_id'] != null) 'line_id': l['line_id'],
      if (l['product_id'] != null) 'product_id': l['product_id'],
      'scanned_barcode': (l['barcode'] as String?) ?? '',
      if (l['expiry_date'] != null) 'expiry_date': l['expiry_date'],
      if (l['location_code'] != null) 'location_code': l['location_code'],
    };
    final Object? pending = l['pending'];
    if (pending is List) {
      // 1.0.49: navbatdagi kiritishlar o'z op_id lari bilan (takror yuborilsa server bir marta qo'llaydi).
      for (final Map<dynamic, dynamic> p in pending.whereType<Map>()) {
        final String mode = (p['mode'] as String?) ?? 'set';
        out.add(<String, Object?>{
          ...base,
          'op_id': p['op_id'],
          'mode': mode,
          if (mode == 'undo') 'undo_op_id': p['undo_op_id'] else 'qty': p['qty'],
          'counted_at': p['counted_at'],
        });
      }
      continue;
    }
    // 1.0.48 (`dirty`) va undan eski (sanalgan, `counted_at` bor) — yuborilmagan jami.
    final bool dirty = l['dirty'] as bool? ?? (l['qty'] != null && l['counted_at'] != null);
    if (dirty && l['qty'] != null) {
      out.add(<String, Object?>{
        ...base,
        'op_id': const Uuid().v4(),
        'mode': 'set',
        'qty': l['qty'],
        if (l['counted_at'] != null) 'counted_at': l['counted_at'],
      });
    }
  }
  return (countId: row['count_id']! as String, entries: out);
}
