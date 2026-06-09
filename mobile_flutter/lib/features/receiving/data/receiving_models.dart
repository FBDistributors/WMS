class ReceiptLineCreate {
  const ReceiptLineCreate({
    required this.productId,
    required this.qty,
    required this.locationId,
    this.batch,
    this.expiryDate,
    this.boxBarcode,
    this.boxCount,
  });

  final String productId;
  final int qty;
  /// Bo‘sh yoki null — server avtomatik partiya yaratadi.
  final String? batch;
  final String locationId;
  final String? expiryDate;
  final String? boxBarcode;
  final int? boxCount;

  Map<String, Object?> toJson() => <String, Object?>{
        'product_id': productId,
        'qty': qty,
        'location_id': locationId,
        if (batch != null && batch!.trim().isNotEmpty) 'batch': batch!.trim(),
        if (expiryDate != null) 'expiry_date': expiryDate,
        if (boxBarcode != null && boxBarcode!.trim().isNotEmpty)
          'box_barcode': boxBarcode!.trim(),
        if (boxCount != null) 'box_count': boxCount,
      };
}

class ReceiptLine {
  const ReceiptLine({
    required this.id,
    required this.productId,
    required this.qty,
    required this.batch,
    required this.locationId,
    this.expiryDate,
  });

  final String id;
  final String productId;
  final int qty;
  final String batch;
  final String locationId;
  final String? expiryDate;

  factory ReceiptLine.fromJson(Map<String, Object?> json) {
    return ReceiptLine(
      id: json['id']! as String,
      productId: json['product_id']! as String,
      qty: _int(json['qty']),
      batch: json['batch'] as String? ?? '',
      locationId: json['location_id']! as String,
      expiryDate: json['expiry_date'] as String?,
    );
  }
}

class Receipt {
  const Receipt({
    required this.id,
    required this.docNo,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    required this.lines,
  });

  final String id;
  final String docNo;
  final String status;
  final String createdAt;
  final String updatedAt;
  final List<ReceiptLine> lines;

  factory Receipt.fromJson(Map<String, Object?> json) {
    final Object? raw = json['lines'];
    final List<ReceiptLine> lines = raw is List
        ? raw
            .whereType<Map<dynamic, dynamic>>()
            .map(
              (Map<dynamic, dynamic> m) =>
                  ReceiptLine.fromJson(Map<String, Object?>.from(m)),
            )
            .toList(growable: false)
        : const <ReceiptLine>[];
    return Receipt(
      id: json['id']! as String,
      docNo: json['doc_no']! as String,
      status: json['status']! as String,
      createdAt: json['created_at']! as String,
      updatedAt: json['updated_at']! as String,
      lines: lines,
    );
  }
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
