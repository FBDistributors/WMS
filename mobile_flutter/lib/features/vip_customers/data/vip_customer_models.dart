class VipCustomerRow {
  const VipCustomerRow({
    required this.id,
    required this.customerId,
    this.customerName,
  });

  final String id;
  final String customerId;
  final String? customerName;

  String get displayLabel {
    final String? n = customerName?.trim();
    if (n != null && n.isNotEmpty) {
      return '$n ($customerId)';
    }
    return customerId;
  }

  factory VipCustomerRow.fromJson(Map<String, Object?> json) {
    return VipCustomerRow(
      id: json['id']! as String,
      customerId: json['customer_id']! as String,
      customerName: json['customer_name'] as String?,
    );
  }
}
