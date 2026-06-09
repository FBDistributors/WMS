class ProductBoxResolve {
  const ProductBoxResolve({
    required this.productId,
    required this.unitsPerBox,
    required this.boxId,
    required this.productName,
    required this.productSku,
    this.productBarcode,
  });

  final String productId;
  final int unitsPerBox;
  final String boxId;
  final String productName;
  final String productSku;
  final String? productBarcode;

  factory ProductBoxResolve.fromJson(Map<String, Object?> json) {
    return ProductBoxResolve(
      productId: '${json['product_id']}',
      unitsPerBox: _int(json['units_per_box']),
      boxId: '${json['box_id']}',
      productName: json['product_name'] as String? ?? '',
      productSku: json['product_sku'] as String? ?? '',
      productBarcode: json['product_barcode'] as String?,
    );
  }
}

class ProductBoxCreate {
  const ProductBoxCreate({
    required this.boxBarcode,
    required this.productId,
    required this.unitsPerBox,
    this.label,
  });

  final String boxBarcode;
  final String productId;
  final int unitsPerBox;
  final String? label;

  Map<String, Object?> toJson() => <String, Object?>{
        'box_barcode': boxBarcode.trim(),
        'product_id': productId,
        'units_per_box': unitsPerBox,
        if (label != null && label!.trim().isNotEmpty) 'label': label!.trim(),
      };
}

int _int(Object? v) {
  if (v is int) {
    return v;
  }
  if (v is num) {
    return v.round();
  }
  return int.tryParse('$v') ?? 0;
}
