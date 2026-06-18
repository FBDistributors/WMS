import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/picking/data/picking_models.dart';
import 'package:mobile_flutter/features/picking/domain/pick_line_list_logic.dart';
import 'package:mobile_flutter/features/picking/domain/pick_scan_resolution.dart';

PickingLine _line({
  required String id,
  required String locationCode,
  String productId = 'prod-1',
  double qtyRequired = 3,
  double qtyPicked = 0,
  String barcode = 'BC-MILK',
}) {
  return PickingLine(
    id: id,
    productName: 'Sut 1L',
    sku: 'SKU-MILK',
    barcode: barcode,
    locationCode: locationCode,
    batch: null,
    expiryDate: '2026-06-01',
    qtyRequired: qtyRequired,
    qtyPicked: qtyPicked,
    skipReason: null,
    productId: productId,
    alternateLocations: const <PickingAlternateLocation>[],
    lineSource: 'product',
  );
}

void main() {
  group('orderedPickerLines', () {
    test('incomplete lines before complete lines', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'a', locationCode: 'P-AO-01', qtyRequired: 3, qtyPicked: 3),
        _line(id: 'b', locationCode: 'P-B-02', qtyRequired: 2, qtyPicked: 0),
      ];

      final List<PickingLine> ordered = orderedPickerLines(lines);

      expect(ordered.map((PickingLine l) => l.id).toList(), <String>['b', 'a']);
    });
  });

  group('pickingLineEffectivelyDone', () {
    test('line is done only when picked meets required', () {
      expect(
        pickingLineEffectivelyDone(
          _line(id: 'a', locationCode: 'P-AO-01', qtyRequired: 3, qtyPicked: 3),
        ),
        isTrue,
      );
      expect(
        pickingLineEffectivelyDone(
          _line(id: 'b', locationCode: 'P-B-02', qtyRequired: 2, qtyPicked: 1),
        ),
        isFalse,
      );
    });
  });

  group('groupLinesByProduct (controller)', () {
    test('same product at two locations merges into one group', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'loc-a', locationCode: 'P-AO-01', qtyRequired: 3, qtyPicked: 3),
        _line(id: 'loc-b', locationCode: 'P-B-02', qtyRequired: 2, qtyPicked: 0),
      ];

      final List<PickLineGroup> groups = groupLinesByProduct(lines);

      expect(groups.length, 1);
      expect(groups.first.members.length, 2);
      expect(groupLocationQtyLine(groups.first), 'P-AO-01: 3/3 · P-B-02: 0/2');
    });

    test('group not fully done until all members picked', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'loc-a', locationCode: 'P-AO-01', qtyRequired: 3, qtyPicked: 3),
        _line(id: 'loc-b', locationCode: 'P-B-02', qtyRequired: 2, qtyPicked: 0),
      ];
      final PickLineGroup g = groupLinesByProduct(lines).single;

      expect(pickLineGroupEffectivelyDone(g), isFalse);

      final List<PickingLine> done = <PickingLine>[
        lines[0],
        _line(id: 'loc-b', locationCode: 'P-B-02', qtyRequired: 2, qtyPicked: 2),
      ];
      expect(pickLineGroupEffectivelyDone(groupLinesByProduct(done).single), isTrue);
    });
  });

  group('pickerLocationQtyLine', () {
    test('shows single location qty only', () {
      final String label = pickerLocationQtyLine(
        _line(id: 'a', locationCode: 'P-AO-01', qtyRequired: 3, qtyPicked: 1),
      );
      expect(label, 'P-AO-01 · 1/3');
    });
  });

  group('resolvePickerScanLine two locations', () {
    test('prefers first open line in document order', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'loc-a', locationCode: 'P-AO-01', qtyRequired: 3, qtyPicked: 3),
        _line(id: 'loc-b', locationCode: 'P-B-02', qtyRequired: 2, qtyPicked: 0),
      ];

      final PickingLine? resolved = resolvePickerScanLine(lines, 'BC-MILK');

      expect(resolved?.id, 'loc-b');
      expect(resolved?.locationCode, 'P-B-02');
    });
  });

  group('pickPositionProgressPicker', () {
    test('counts done lines not quantities', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'a', locationCode: 'P-AO-01', qtyRequired: 3, qtyPicked: 3),
        _line(id: 'b', locationCode: 'P-B-02', qtyRequired: 2, qtyPicked: 0),
      ];

      final PickPositionProgress progress = pickPositionProgressPicker(lines);

      expect(progress.done, 1);
      expect(progress.total, 2);
    });

    test('all lines done gives full position count', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'a', locationCode: 'P-AO-01', qtyRequired: 2, qtyPicked: 2),
        _line(id: 'b', locationCode: 'P-AS-03', qtyRequired: 1, qtyPicked: 1),
      ];

      final PickPositionProgress progress = pickPositionProgressPicker(lines);

      expect(progress.done, 2);
      expect(progress.total, 2);
    });
  });

  group('pickPositionProgressController', () {
    test('counts product groups not unit quantities', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(
          id: 'scrub-a',
          locationCode: 'P-AU-01',
          productId: 'prod-strawberry',
          barcode: '4607953918404',
          qtyRequired: 2,
          qtyPicked: 2,
        ),
        _line(
          id: 'scrub-b',
          locationCode: 'P-AS-03',
          productId: 'prod-mango',
          barcode: '4607953918350',
          qtyRequired: 1,
          qtyPicked: 1,
        ),
      ];

      final PickPositionProgress progress =
          pickPositionProgressController(lines, <String>{});

      expect(progress.done, 2);
      expect(progress.total, 2);
    });

    test('verified group counts as done even if not fully picked', () {
      final List<PickingLine> lines = <PickingLine>[
        _line(id: 'a', locationCode: 'P-AO-01', productId: 'p1', qtyRequired: 3, qtyPicked: 1),
        _line(id: 'b', locationCode: 'P-B-02', productId: 'p2', qtyRequired: 2, qtyPicked: 0),
      ];

      final PickPositionProgress progress = pickPositionProgressController(
        lines,
        <String>{'a'},
      );

      expect(progress.done, 1);
      expect(progress.total, 2);
    });
  });
}
