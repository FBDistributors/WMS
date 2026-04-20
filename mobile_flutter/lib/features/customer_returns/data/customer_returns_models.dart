class CustomerReturnLine {
  const CustomerReturnLine({
    required this.id,
    required this.productId,
    required this.locationId,
    required this.productName,
    required this.locationCode,
    required this.qty,
    required this.batch,
    required this.expiryDate,
  });

  final String id;
  final String productId;
  final String locationId;
  final String productName;
  final String locationCode;
  final int qty;
  final String batch;
  final String? expiryDate;

  factory CustomerReturnLine.fromJson(Map<String, Object?> json) {
    return CustomerReturnLine(
      id: json['id']! as String,
      productId: json['product_id']! as String,
      locationId: json['location_id']! as String,
      productName: json['product_name']! as String,
      locationCode: json['location_code']! as String,
      qty: _int(json['qty']),
      batch: json['batch'] as String? ?? '',
      expiryDate: json['expiry_date'] as String?,
    );
  }
}

class CustomerReturn {
  const CustomerReturn({
    required this.id,
    required this.docNo,
    this.customerId,
    this.customerName,
    required this.status,
    required this.createdByUserId,
    required this.approvedByUserId,
    required this.assignedPickerUserId,
    required this.createdAt,
    required this.updatedAt,
    required this.lines,
  });

  final String id;
  final String docNo;
  final String? customerId;
  final String? customerName;
  final String status;
  final String? createdByUserId;
  final String? approvedByUserId;
  final String? assignedPickerUserId;
  final String createdAt;
  final String updatedAt;
  final List<CustomerReturnLine> lines;

  factory CustomerReturn.fromJson(Map<String, Object?> json) {
    final Object? raw = json['lines'];
    final List<CustomerReturnLine> lines = raw is List
        ? raw
            .whereType<Map<dynamic, dynamic>>()
            .map(
              (Map<dynamic, dynamic> m) =>
                  CustomerReturnLine.fromJson(Map<String, Object?>.from(m)),
            )
            .toList(growable: false)
        : const <CustomerReturnLine>[];
    return CustomerReturn(
      id: json['id']! as String,
      docNo: json['doc_no']! as String,
      customerId: json['customer_id'] as String?,
      customerName: json['customer_name'] as String?,
      status: json['status']! as String,
      createdByUserId: json['created_by_user_id'] as String?,
      approvedByUserId: json['approved_by_user_id'] as String?,
      assignedPickerUserId: json['assigned_picker_user_id'] as String?,
      createdAt: json['created_at']! as String,
      updatedAt: json['updated_at']! as String,
      lines: lines,
    );
  }
}

class CustomerReturnListResponse {
  const CustomerReturnListResponse({
    required this.items,
    required this.total,
  });

  final List<CustomerReturn> items;
  final int total;

  factory CustomerReturnListResponse.fromJson(Map<String, Object?> json) {
    final Object? raw = json['items'];
    final List<CustomerReturn> items = raw is List
        ? raw
            .whereType<Map<dynamic, dynamic>>()
            .map(
              (Map<dynamic, dynamic> m) =>
                  CustomerReturn.fromJson(Map<String, Object?>.from(m)),
            )
            .toList(growable: false)
        : const <CustomerReturn>[];
    return CustomerReturnListResponse(
      items: items,
      total: _int(json['total']),
    );
  }
}

class CreateCustomerReturnLine {
  const CreateCustomerReturnLine({
    required this.productId,
    required this.locationId,
    required this.qty,
    required this.productName,
    required this.locationCode,
    this.batch,
    this.expiryDate,
  });

  final String productId;
  final String locationId;
  final int qty;
  final String productName;
  final String locationCode;
  final String? batch;
  final String? expiryDate;

  Map<String, Object?> toJson() => <String, Object?>{
        'product_id': productId,
        'location_id': locationId,
        'qty': qty,
        'product_name': productName,
        'location_code': locationCode,
        if (batch != null) 'batch': batch,
        if (expiryDate != null) 'expiry_date': expiryDate,
      };
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
