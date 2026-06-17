import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/product_boxes/data/product_box_models.dart';

void main() {
  test('ProductBoxReplaceBarcode serializes for API', () {
    const ProductBoxReplaceBarcode payload = ProductBoxReplaceBarcode(
      oldBoxId: 'old-id',
      newBarcode: ' NEW-CODE ',
      productId: 'prod-id',
      unitsPerBox: 12,
    );
    expect(payload.toJson(), <String, Object?>{
      'old_box_id': 'old-id',
      'new_barcode': 'NEW-CODE',
      'product_id': 'prod-id',
      'units_per_box': 12,
    });
  });
}
