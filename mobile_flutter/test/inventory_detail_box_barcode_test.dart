import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/inventory/data/models/picker_inventory_models.dart';
import 'package:mobile_flutter/features/inventory/presentation/inventory_detail_screen.dart';

void main() {
  test('PickerProductLocation.fromJson parses sealed_boxes', () {
    final PickerProductLocation loc = PickerProductLocation.fromJson(<String, Object?>{
      'location_id': 'loc-1',
      'location_code': 'P-F-04',
      'lot_id': 'lot-1',
      'batch_no': 'B1',
      'expiry_date': '2029-04-01',
      'on_hand_qty': 114,
      'reserved_qty': 0,
      'available_qty': 114,
      'box_count': 7,
      'units_in_boxes': 112,
      'loose_units': 2,
      'sealed_boxes': <Object?>[
        <String, Object?>{
          'box_barcode': 'BOX-A',
          'units_per_box': 16,
          'count': 5,
        },
        <String, Object?>{
          'box_barcode': 'BOX-B',
          'units_per_box': 16,
          'count': 2,
        },
      ],
    });
    expect(loc.sealedBoxes, hasLength(2));
    expect(loc.sealedBoxes.first.boxBarcode, 'BOX-A');
  });

  test('mergePickerSealedBoxLines sums counts for same barcode and upb', () {
    const PickerSealedBoxLine a = PickerSealedBoxLine(
      boxBarcode: 'BOX-A',
      unitsPerBox: 16,
      count: 2,
    );
    const PickerSealedBoxLine b = PickerSealedBoxLine(
      boxBarcode: 'BOX-A',
      unitsPerBox: 16,
      count: 3,
    );
    const PickerSealedBoxLine c = PickerSealedBoxLine(
      boxBarcode: 'BOX-B',
      unitsPerBox: 10,
      count: 1,
    );
    final List<PickerSealedBoxLine> merged = mergePickerSealedBoxLines(
      <PickerSealedBoxLine>[a, c],
      <PickerSealedBoxLine>[b],
    );
    expect(merged, hasLength(2));
    expect(merged.first.boxBarcode, 'BOX-A');
    expect(merged.first.count, 5);
    expect(merged.last.boxBarcode, 'BOX-B');
  });

  test('sealedBoxBarcodeDisplayLines formats label and count suffix', () {
    final List<String> lines = sealedBoxBarcodeDisplayLines(
      label: 'Quti shtrix-kodi',
      sealedBoxes: const <PickerSealedBoxLine>[
        PickerSealedBoxLine(boxBarcode: 'BOX-A', unitsPerBox: 16, count: 5),
        PickerSealedBoxLine(boxBarcode: 'BOX-B', unitsPerBox: 16, count: 2),
      ],
    );
    expect(lines[0], 'Quti shtrix-kodi: BOX-A (5 × 16)');
    expect(lines[1], 'BOX-B (2 × 16)');
  });

  test('mergePickerProductLocationsForDisplay merges sealedBoxes', () {
    const PickerProductLocation lotA = PickerProductLocation(
      locationId: 'loc-1',
      locationCode: 'P-F-04',
      lotId: 'lot-a',
      batchNo: 'B1',
      expiryDate: '2029-04-01',
      onHandQty: 50,
      reservedQty: 0,
      availableQty: 50,
      boxCount: 2,
      unitsInBoxes: 32,
      looseUnits: 0,
      sealedBoxes: <PickerSealedBoxLine>[
        PickerSealedBoxLine(boxBarcode: 'BOX-A', unitsPerBox: 16, count: 2),
      ],
    );
    const PickerProductLocation lotB = PickerProductLocation(
      locationId: 'loc-1',
      locationCode: 'P-F-04',
      lotId: 'lot-b',
      batchNo: 'B2',
      expiryDate: '2029-04-01',
      onHandQty: 64,
      reservedQty: 0,
      availableQty: 64,
      boxCount: 3,
      unitsInBoxes: 48,
      looseUnits: 0,
      sealedBoxes: <PickerSealedBoxLine>[
        PickerSealedBoxLine(boxBarcode: 'BOX-A', unitsPerBox: 16, count: 1),
        PickerSealedBoxLine(boxBarcode: 'BOX-B', unitsPerBox: 16, count: 2),
      ],
    );
    final List<PickerProductLocation> merged = mergePickerProductLocationsForDisplay(
      <PickerProductLocation>[lotA, lotB],
    );
    expect(merged, hasLength(1));
    expect(merged.first.sealedBoxes, hasLength(2));
    final PickerSealedBoxLine boxA = merged.first.sealedBoxes.firstWhere(
      (PickerSealedBoxLine line) => line.boxBarcode == 'BOX-A',
    );
    expect(boxA.count, 3);
  });
}
