// Mirrors mobile/src/api/picking.types.ts

class PickingAlternateLocation {
  const PickingAlternateLocation({
    required this.locationId,
    required this.locationCode,
    required this.lotId,
    required this.availableQty,
    required this.batch,
    required this.expiryDate,
    required this.isPrimary,
  });

  final String locationId;
  final String locationCode;
  final String lotId;
  final double availableQty;
  final String? batch;
  final String? expiryDate;
  final bool isPrimary;

  factory PickingAlternateLocation.fromJson(Map<String, Object?> json) {
    return PickingAlternateLocation(
      locationId: json['location_id']! as String,
      locationCode: json['location_code']! as String,
      lotId: json['lot_id']! as String,
      availableQty: _num(json['available_qty']),
      batch: json['batch'] as String?,
      expiryDate: json['expiry_date'] as String?,
      isPrimary: json['is_primary'] == true,
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'location_id': locationId,
        'location_code': locationCode,
        'lot_id': lotId,
        'available_qty': availableQty,
        'batch': batch,
        'expiry_date': expiryDate,
        'is_primary': isPrimary,
      };
}

class PickingLine {
  const PickingLine({
    required this.id,
    required this.productName,
    required this.sku,
    required this.barcode,
    required this.locationCode,
    required this.batch,
    required this.expiryDate,
    required this.qtyRequired,
    required this.qtyPicked,
    required this.skipReason,
    required this.productId,
    required this.alternateLocations,
  });

  final String id;
  final String productName;
  final String? sku;
  final String? barcode;
  final String locationCode;
  final String? batch;
  final String? expiryDate;
  final double qtyRequired;
  final double qtyPicked;
  final String? skipReason;
  final String? productId;
  final List<PickingAlternateLocation> alternateLocations;

  factory PickingLine.fromJson(Map<String, Object?> json) {
    final Object? alts = json['alternate_locations'];
    final List<PickingAlternateLocation> list = alts is List
        ? alts
            .whereType<Map<dynamic, dynamic>>()
            .map((Map<dynamic, dynamic> m) => PickingAlternateLocation.fromJson(
                  Map<String, Object?>.from(m),
                ))
            .toList(growable: false)
        : const <PickingAlternateLocation>[];
    return PickingLine(
      id: json['id']! as String,
      productName: json['product_name']! as String,
      sku: json['sku'] as String?,
      barcode: json['barcode'] as String?,
      locationCode: json['location_code']! as String,
      batch: json['batch'] as String?,
      expiryDate: json['expiry_date'] as String?,
      qtyRequired: _num(json['qty_required']),
      qtyPicked: _num(json['qty_picked']),
      skipReason: json['skip_reason'] as String?,
      productId: json['product_id'] as String?,
      alternateLocations: list,
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'product_name': productName,
        'sku': sku,
        'barcode': barcode,
        'location_code': locationCode,
        'batch': batch,
        'expiry_date': expiryDate,
        'qty_required': qtyRequired,
        'qty_picked': qtyPicked,
        'skip_reason': skipReason,
        'product_id': productId,
        'alternate_locations':
            alternateLocations.map((PickingAlternateLocation a) => a.toJson()).toList(),
      };
}

class PickingProgress {
  const PickingProgress({required this.picked, required this.required});

  final double picked;
  final double required;

  factory PickingProgress.fromJson(Map<String, Object?> json) {
    return PickingProgress(
      picked: _num(json['picked']),
      required: _num(json['required']),
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'picked': picked,
        'required': required,
      };
}

class PickingDocument {
  const PickingDocument({
    required this.id,
    required this.referenceNumber,
    required this.status,
    required this.lines,
    required this.progress,
    required this.incompleteReason,
    required this.assignedToUserId,
    required this.assignedToUserName,
    required this.orderNumber,
  });

  final String id;
  final String referenceNumber;
  final String status;
  final List<PickingLine> lines;
  final PickingProgress progress;
  final String? incompleteReason;
  final String? assignedToUserId;
  final String? assignedToUserName;
  final String? orderNumber;

  factory PickingDocument.fromJson(Map<String, Object?> json) {
    final Object? linesRaw = json['lines'];
    final List<PickingLine> lines = linesRaw is List
        ? linesRaw
            .whereType<Map<dynamic, dynamic>>()
            .map((Map<dynamic, dynamic> m) =>
                PickingLine.fromJson(Map<String, Object?>.from(m)))
            .toList(growable: false)
        : const <PickingLine>[];
    final Object? prog = json['progress'];
    return PickingDocument(
      id: json['id']! as String,
      referenceNumber: json['reference_number']! as String,
      status: json['status']! as String,
      lines: lines,
      progress: prog is Map
          ? PickingProgress.fromJson(Map<String, Object?>.from(prog))
          : const PickingProgress(picked: 0.0, required: 0.0),
      incompleteReason: json['incomplete_reason'] as String?,
      assignedToUserId: json['assigned_to_user_id'] as String?,
      assignedToUserName: json['assigned_to_user_name'] as String?,
      orderNumber: json['order_number'] as String?,
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'reference_number': referenceNumber,
        'status': status,
        'lines': lines.map((PickingLine l) => l.toJson()).toList(),
        'progress': progress.toJson(),
        'incomplete_reason': incompleteReason,
        'assigned_to_user_id': assignedToUserId,
        'assigned_to_user_name': assignedToUserName,
        'order_number': orderNumber,
      };

  PickingDocument applyPickLineResponse(PickLineResponse res) {
    final List<PickingLine> newLines = lines
        .map((PickingLine l) => l.id == res.line.id ? res.line : l)
        .toList(growable: false);
    return PickingDocument(
      id: id,
      referenceNumber: referenceNumber,
      status: res.documentStatus,
      lines: newLines,
      progress: res.progress,
      incompleteReason: incompleteReason,
      assignedToUserId: assignedToUserId,
      assignedToUserName: assignedToUserName,
      orderNumber: orderNumber,
    );
  }
}

class PickingListItem {
  const PickingListItem({
    required this.id,
    required this.referenceNumber,
    required this.status,
    required this.linesTotal,
    required this.linesDone,
    required this.pickedAny,
    required this.controlledByUserId,
    required this.assignedToUserId,
    required this.assignedToUserName,
    required this.orderNumber,
    required this.deliveryNumber,
    required this.sentToControllerAt,
  });

  final String id;
  final String referenceNumber;
  final String status;
  final int linesTotal;
  final int linesDone;
  final bool pickedAny;
  final String? controlledByUserId;
  final String? assignedToUserId;
  final String? assignedToUserName;
  final String? orderNumber;
  final String? deliveryNumber;
  final String? sentToControllerAt;

  factory PickingListItem.fromJson(Map<String, Object?> json) {
    return PickingListItem(
      id: json['id']! as String,
      referenceNumber: json['reference_number']! as String,
      status: json['status']! as String,
      linesTotal: _int(json['lines_total']),
      linesDone: _int(json['lines_done']),
      pickedAny: json['picked_any'] == true,
      controlledByUserId: json['controlled_by_user_id'] as String?,
      assignedToUserId: json['assigned_to_user_id'] as String?,
      assignedToUserName: json['assigned_to_user_name'] as String?,
      orderNumber: json['order_number'] as String?,
      deliveryNumber: json['delivery_number'] as String?,
      sentToControllerAt: json['sent_to_controller_at'] as String?,
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'reference_number': referenceNumber,
        'status': status,
        'lines_total': linesTotal,
        'lines_done': linesDone,
        'picked_any': pickedAny,
        'controlled_by_user_id': controlledByUserId,
        'assigned_to_user_id': assignedToUserId,
        'assigned_to_user_name': assignedToUserName,
        'order_number': orderNumber,
        'delivery_number': deliveryNumber,
        'sent_to_controller_at': sentToControllerAt,
      };
}

class PickLineResponse {
  const PickLineResponse({
    required this.line,
    required this.progress,
    required this.documentStatus,
  });

  final PickingLine line;
  final PickingProgress progress;
  final String documentStatus;

  factory PickLineResponse.fromJson(Map<String, Object?> json) {
    final Object? line = json['line'];
    final Object? prog = json['progress'];
    return PickLineResponse(
      line: line is Map
          ? PickingLine.fromJson(Map<String, Object?>.from(line))
          : throw const FormatException('line'),
      progress: prog is Map
          ? PickingProgress.fromJson(Map<String, Object?>.from(prog))
          : const PickingProgress(picked: 0.0, required: 0.0),
      documentStatus: json['document_status']! as String,
    );
  }
}

class ConsolidatedLineItem {
  const ConsolidatedLineItem({
    required this.documentId,
    required this.lineId,
    required this.referenceNumber,
    required this.qtyRequired,
    required this.qtyPicked,
    required this.locationCode,
    required this.pickSequence,
    required this.expiryDate,
  });

  final String documentId;
  final String lineId;
  final String referenceNumber;
  final double qtyRequired;
  final double qtyPicked;
  final String locationCode;
  final int? pickSequence;
  final String? expiryDate;

  factory ConsolidatedLineItem.fromJson(Map<String, Object?> json) {
    return ConsolidatedLineItem(
      documentId: json['document_id']! as String,
      lineId: json['line_id']! as String,
      referenceNumber: json['reference_number']! as String,
      qtyRequired: _num(json['qty_required']),
      qtyPicked: _num(json['qty_picked']),
      locationCode: json['location_code']! as String,
      pickSequence: (json['pick_sequence'] as num?)?.toInt(),
      expiryDate: json['expiry_date'] as String?,
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'document_id': documentId,
        'line_id': lineId,
        'reference_number': referenceNumber,
        'qty_required': qtyRequired,
        'qty_picked': qtyPicked,
        'location_code': locationCode,
        'pick_sequence': pickSequence,
        'expiry_date': expiryDate,
      };
}

class ConsolidatedProduct {
  const ConsolidatedProduct({
    required this.barcode,
    required this.sku,
    required this.productName,
    required this.productId,
    required this.totalRequired,
    required this.totalPicked,
    required this.expiryDate,
    required this.alternateLocations,
    required this.lines,
  });

  final String? barcode;
  final String? sku;
  final String productName;
  final String? productId;
  final double totalRequired;
  final double totalPicked;
  final String? expiryDate;
  final List<PickingAlternateLocation> alternateLocations;
  final List<ConsolidatedLineItem> lines;

  factory ConsolidatedProduct.fromJson(Map<String, Object?> json) {
    final Object? alts = json['alternate_locations'];
    final List<PickingAlternateLocation> al = alts is List
        ? alts
            .whereType<Map<dynamic, dynamic>>()
            .map((Map<dynamic, dynamic> m) => PickingAlternateLocation.fromJson(
                  Map<String, Object?>.from(m),
                ))
            .toList(growable: false)
        : const <PickingAlternateLocation>[];
    final Object? linesRaw = json['lines'];
    final List<ConsolidatedLineItem> lines = linesRaw is List
        ? linesRaw
            .whereType<Map<dynamic, dynamic>>()
            .map((Map<dynamic, dynamic> m) =>
                ConsolidatedLineItem.fromJson(Map<String, Object?>.from(m)))
            .toList(growable: false)
        : const <ConsolidatedLineItem>[];
    return ConsolidatedProduct(
      barcode: json['barcode'] as String?,
      sku: json['sku'] as String?,
      productName: json['product_name']! as String,
      productId: json['product_id'] as String?,
      totalRequired: _num(json['total_required']),
      totalPicked: _num(json['total_picked']),
      expiryDate: json['expiry_date'] as String?,
      alternateLocations: al,
      lines: lines,
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'barcode': barcode,
        'sku': sku,
        'product_name': productName,
        'product_id': productId,
        'total_required': totalRequired,
        'total_picked': totalPicked,
        'expiry_date': expiryDate,
        'alternate_locations':
            alternateLocations.map((PickingAlternateLocation a) => a.toJson()).toList(),
        'lines': lines.map((ConsolidatedLineItem l) => l.toJson()).toList(),
      };
}

class ConsolidatedDocumentSummary {
  const ConsolidatedDocumentSummary({
    required this.id,
    required this.referenceNumber,
    required this.status,
    required this.linesTotal,
    required this.linesDone,
  });

  final String id;
  final String referenceNumber;
  final String status;
  final int linesTotal;
  final int linesDone;

  factory ConsolidatedDocumentSummary.fromJson(Map<String, Object?> json) {
    return ConsolidatedDocumentSummary(
      id: json['id']! as String,
      referenceNumber: json['reference_number']! as String,
      status: json['status']! as String,
      linesTotal: _int(json['lines_total']),
      linesDone: _int(json['lines_done']),
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'reference_number': referenceNumber,
        'status': status,
        'lines_total': linesTotal,
        'lines_done': linesDone,
      };
}

class ConsolidatedViewResponse {
  const ConsolidatedViewResponse({
    required this.documents,
    required this.products,
  });

  final List<ConsolidatedDocumentSummary> documents;
  final List<ConsolidatedProduct> products;

  factory ConsolidatedViewResponse.fromJson(Map<String, Object?> json) {
    final Object? d = json['documents'];
    final Object? p = json['products'];
    return ConsolidatedViewResponse(
      documents: d is List
          ? d
              .whereType<Map<dynamic, dynamic>>()
              .map((Map<dynamic, dynamic> m) =>
                  ConsolidatedDocumentSummary.fromJson(
                    Map<String, Object?>.from(m),
                  ))
              .toList(growable: false)
          : const <ConsolidatedDocumentSummary>[],
      products: p is List
          ? p
              .whereType<Map<dynamic, dynamic>>()
              .map((Map<dynamic, dynamic> m) =>
                  ConsolidatedProduct.fromJson(Map<String, Object?>.from(m)))
              .toList(growable: false)
          : const <ConsolidatedProduct>[],
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'documents':
            documents.map((ConsolidatedDocumentSummary d) => d.toJson()).toList(),
        'products': products.map((ConsolidatedProduct p) => p.toJson()).toList(),
      };
}

/// React Native `consolidatedProductKey` bilan bir xil.
String consolidatedProductKey(ConsolidatedProduct p) =>
    '${p.productName}-${p.barcode ?? p.sku ?? ''}';

/// Umumiy yig‘ish: shtrix yoki SKU bilan aniq moslik (trim, RN ConsolidatedPickContent).
bool consolidatedScanMatchesProduct(String raw, ConsolidatedProduct p) {
  final String scanned = raw.trim();
  if (scanned.isEmpty) {
    return false;
  }
  final String b = (p.barcode ?? '').trim();
  final String s = (p.sku ?? '').trim();
  return (b.isNotEmpty && scanned == b) || (s.isNotEmpty && scanned == s);
}

/// Mos mahsulot bo‘lsa — yig‘ish qoldig‘i (rounded); moslik yo‘q bo‘lsa `null`.
int? consolidatedOpenPickQtyForBarcode(String raw, List<ConsolidatedProduct> products) {
  for (final ConsolidatedProduct p in products) {
    if (consolidatedScanMatchesProduct(raw, p)) {
      final int n = (p.totalRequired - p.totalPicked).round();
      return n < 0 ? 0 : n;
    }
  }
  return null;
}

class MyPickerStatsDay {
  const MyPickerStatsDay({required this.date, required this.count});

  final String date;
  final int count;

  factory MyPickerStatsDay.fromJson(Map<String, Object?> json) {
    return MyPickerStatsDay(
      date: json['date']! as String,
      count: _int(json['count']),
    );
  }
}

class MyPickerStats {
  const MyPickerStats({
    required this.totalCompleted,
    required this.completedToday,
    required this.byDay,
  });

  final int totalCompleted;
  final int completedToday;
  final List<MyPickerStatsDay> byDay;

  factory MyPickerStats.fromJson(Map<String, Object?> json) {
    final Object? bd = json['by_day'];
    return MyPickerStats(
      totalCompleted: _int(json['total_completed']),
      completedToday: _int(json['completed_today']),
      byDay: bd is List
          ? bd
              .whereType<Map<dynamic, dynamic>>()
              .map((Map<dynamic, dynamic> m) =>
                  MyPickerStatsDay.fromJson(Map<String, Object?>.from(m)))
              .toList(growable: false)
          : const <MyPickerStatsDay>[],
    );
  }
}

class PickerUser {
  const PickerUser({
    required this.id,
    required this.username,
    required this.fullName,
  });

  final String id;
  final String username;
  final String? fullName;

  factory PickerUser.fromJson(Map<String, Object?> json) {
    return PickerUser(
      id: json['id']! as String,
      username: json['username']! as String,
      fullName: json['full_name'] as String?,
    );
  }
}

class ControllerUser {
  const ControllerUser({
    required this.id,
    required this.username,
    required this.fullName,
  });

  final String id;
  final String username;
  final String? fullName;

  factory ControllerUser.fromJson(Map<String, Object?> json) {
    return ControllerUser(
      id: json['id']! as String,
      username: json['username']! as String,
      fullName: json['full_name'] as String?,
    );
  }
}

double _num(Object? v) {
  if (v is num) {
    return v.toDouble();
  }
  if (v is String) {
    return double.tryParse(v) ?? 0;
  }
  return 0;
}

/// Ro‘yxat/kartochkada miqdorni butun son sifatida ko‘rsatish.
String formatPickQty(num v) {
  final double d = v.toDouble();
  if (d.isNaN || d.isInfinite) {
    return '0';
  }
  return '${d.round()}';
}

int _int(Object? v) {
  if (v is int) {
    return v;
  }
  if (v is num) {
    return v.toInt();
  }
  if (v is String) {
    return int.tryParse(v) ?? 0;
  }
  return 0;
}
