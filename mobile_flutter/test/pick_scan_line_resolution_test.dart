import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/picking/data/picking_models.dart';
import 'package:mobile_flutter/features/picking/domain/pick_scan_resolution.dart';

PickingLine _line({
  required String id,
  required String productId,
  String lineSource = 'product',
  double qtyRequired = 2,
  double qtyPicked = 0,
  String barcode = 'BC123',
  String sku = 'SKU123',
}) {
  return PickingLine(
    id: id,
    productName: 'Test Product',
    sku: sku,
    barcode: barcode,
    locationCode: 'A-01',
    batch: null,
    expiryDate: null,
    qtyRequired: qtyRequired,
    qtyPicked: qtyPicked,
    skipReason: null,
    productId: productId,
    alternateLocations: const <PickingAlternateLocation>[],
    lineSource: lineSource,
  );
}

void main() {
  group('resolvePickerScanLine', () {
    test('prefers open action line when product line is fully picked', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'main', productId: 'p1', lineSource: 'product', qtyPicked: 2),
        _line(id: 'promo', productId: 'p1', lineSource: 'action', qtyPicked: 0),
      ];

      final PickingLine? resolved = resolvePickerScanLine(lines, 'BC123');

      expect(resolved?.id, 'promo');
      expect(resolved?.lineSource, 'action');
    });

    test('returns first match when all lines are fully picked', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'main', productId: 'p1', lineSource: 'product', qtyPicked: 2),
        _line(id: 'promo', productId: 'p1', lineSource: 'action', qtyPicked: 2),
      ];

      final PickingLine? resolved = resolvePickerScanLine(lines, 'BC123');

      expect(resolved?.id, 'main');
    });
  });

  group('resolveControllerScanLine', () {
    test('prefers unverified action group when product group is verified', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'main', productId: 'p1', lineSource: 'product'),
        _line(id: 'promo', productId: 'p1', lineSource: 'action'),
      ];
      final Set<String> verified = <String>{'main'};

      final PickingLine? resolved =
          resolveControllerScanLine(lines, 'BC123', verified);

      expect(resolved?.id, 'promo');
    });

    test('returns first match when all matching groups are verified', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'main', productId: 'p1', lineSource: 'product'),
        _line(id: 'promo', productId: 'p1', lineSource: 'action'),
      ];
      final Set<String> verified = <String>{'main', 'promo'};

      final PickingLine? resolved =
          resolveControllerScanLine(lines, 'BC123', verified);

      expect(resolved?.id, 'main');
    });

    test('skipped zero-picked promo line does not hijack scan of the picked line', () {
      // Aksiya qatori ro'yxatda birinchi, 0 terilgan (skip); oddiy qator
      // 7/7 terilgan va hali tekshirilmagan — skan oddiy qatorga tushishi kerak.
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'promo', productId: 'p1', lineSource: 'action', qtyRequired: 1, qtyPicked: 0),
        _line(id: 'main', productId: 'p1', lineSource: 'product', qtyRequired: 7, qtyPicked: 7),
      ];

      final PickingLine? resolved =
          resolveControllerScanLine(lines, 'BC123', <String>{});

      expect(resolved?.id, 'main');
    });

    test('falls back to skipped zero-picked line when picked line is verified', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'promo', productId: 'p1', lineSource: 'action', qtyRequired: 1, qtyPicked: 0),
        _line(id: 'main', productId: 'p1', lineSource: 'product', qtyRequired: 7, qtyPicked: 7),
      ];
      final Set<String> verified = <String>{'main'};

      final PickingLine? resolved =
          resolveControllerScanLine(lines, 'BC123', verified);

      expect(resolved?.id, 'promo');
    });
  });

  group('resolveControllerScanLineByProductId', () {
    test('prefers unverified action group when product group is verified', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'main', productId: 'p1', lineSource: 'product'),
        _line(id: 'promo', productId: 'p1', lineSource: 'action'),
      ];
      final Set<String> verified = <String>{'main'};

      final PickingLine? resolved =
          resolveControllerScanLineByProductId(lines, 'p1', verified);

      expect(resolved?.id, 'promo');
    });

    test('returns first match when all matching groups are verified', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'main', productId: 'p1', lineSource: 'product'),
        _line(id: 'promo', productId: 'p1', lineSource: 'action'),
      ];
      final Set<String> verified = <String>{'main', 'promo'};

      final PickingLine? resolved =
          resolveControllerScanLineByProductId(lines, 'p1', verified);

      expect(resolved?.id, 'main');
    });

    test('returns first match when multiple groups are unverified', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'main', productId: 'p1', lineSource: 'product', qtyPicked: 2),
        _line(id: 'promo', productId: 'p1', lineSource: 'action', qtyPicked: 0),
      ];

      final PickingLine? resolved =
          resolveControllerScanLineByProductId(lines, 'p1', <String>{});

      expect(resolved?.id, 'main');
    });
  });

  group('resolvePickerScanLineByProductId', () {
    test('prefers open line for product id', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'main', productId: 'p1', lineSource: 'product', qtyPicked: 2),
        _line(id: 'promo', productId: 'p1', lineSource: 'action', qtyPicked: 0),
      ];

      final PickingLine? resolved =
          resolvePickerScanLineByProductId(lines, 'p1');

      expect(resolved?.id, 'promo');
    });
  });

  group('resolveScanLineInGroup', () {
    test('only matches members of the current group', () {
      final List<PickingLine> groupMembers = <PickingLine>[
        _line(id: 'promo', productId: 'p1', lineSource: 'action', barcode: 'BC123'),
      ];

      expect(resolveScanLineInGroup(groupMembers, 'BC123')?.id, 'promo');
      expect(resolveScanLineInGroup(groupMembers, 'OTHER'), isNull);
    });
  });

  group('resolveSubmitScanLine', () {
    test('prefers open line without lineId', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'main', productId: 'p1', lineSource: 'product', qtyPicked: 2),
        _line(id: 'promo', productId: 'p1', lineSource: 'action', qtyPicked: 0),
      ];

      final PickingLine? resolved = resolveSubmitScanLine(lines, 'BC123');

      expect(resolved?.id, 'promo');
    });
  });

  group('scanPresetIsBoxForLine', () {
    final PickingLine line = _line(id: 'l1', productId: 'p1', barcode: 'BC123', sku: 'SKU123');

    test('box scan matching product barcode is treated as unit (collision)', () {
      expect(
        scanPresetIsBoxForLine(
          isBoxScan: true,
          scannedBarcode: 'BC123',
          line: line,
        ),
        isFalse,
      );
    });

    test('box scan matching sku is treated as unit', () {
      expect(
        scanPresetIsBoxForLine(
          isBoxScan: true,
          scannedBarcode: 'SKU123',
          line: line,
        ),
        isFalse,
      );
    });

    test('genuine box code (no product match) stays box', () {
      expect(
        scanPresetIsBoxForLine(
          isBoxScan: true,
          scannedBarcode: 'BOX-XYZ',
          line: line,
        ),
        isTrue,
      );
    });

    test('unit scan is never box', () {
      expect(
        scanPresetIsBoxForLine(
          isBoxScan: false,
          scannedBarcode: 'BOX-XYZ',
          line: line,
        ),
        isFalse,
      );
    });
  });
}
