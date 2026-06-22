import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/picking/data/picking_models.dart';

void main() {
  test('PickingLine.fromJson parses picked_box_barcode', () {
    final PickingLine line = PickingLine.fromJson(<String, Object?>{
      'id': 'line-1',
      'product_name': 'Test product',
      'sku': 'SKU1',
      'barcode': '4620223890286',
      'location_code': 'P-G-02',
      'batch': null,
      'expiry_date': null,
      'qty_required': 120,
      'qty_picked': 120,
      'skip_reason': null,
      'product_id': 'prod-1',
      'alternate_locations': <Object?>[],
      'picked_box_barcode': 'BOX-PICKED-001',
    });
    expect(line.pickedBoxBarcode, 'BOX-PICKED-001');
    expect(displayPickedBoxBarcode(line), 'BOX-PICKED-001');
  });

  test('displayPickedBoxBarcode returns null for empty values', () {
    const PickingLine line = PickingLine(
      id: 'line-1',
      productName: 'Test',
      sku: null,
      barcode: null,
      locationCode: 'A-01',
      batch: null,
      expiryDate: null,
      qtyRequired: 1,
      qtyPicked: 1,
      skipReason: null,
      productId: null,
      alternateLocations: <PickingAlternateLocation>[],
      pickedBoxBarcode: '  ',
    );
    expect(displayPickedBoxBarcode(line), isNull);
  });
}
