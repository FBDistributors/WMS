import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/picking/data/picking_models.dart';
import 'package:mobile_flutter/features/picking/presentation/pick_task_list_screen.dart';

PickingListItem _doc({
  required String id,
  String? controlledByUserId,
  String? controllerVerificationStartedAt,
  String sourceGroup = kSourceGroupCity,
}) {
  return PickingListItem(
    id: id,
    referenceNumber: 'SO-$id',
    status: 'picked',
    linesTotal: 2,
    linesDone: 2,
    pickedAny: true,
    controlledByUserId: controlledByUserId,
    assignedToUserId: 'p1',
    assignedToUserName: 'Picker',
    orderNumber: '1003$id',
    deliveryNumber: null,
    sentToControllerAt: '2026-07-23T10:00:00Z',
    controllerVerificationStartedAt: controllerVerificationStartedAt,
    sourceGroup: sourceGroup,
  );
}

void main() {
  group('controllerDocIsInQueue', () {
    test('unclaimed document is in the shared queue', () {
      expect(controllerDocIsInQueue(_doc(id: '1')), isTrue);
    });

    test('claimed document is not in the queue', () {
      expect(
        controllerDocIsInQueue(_doc(id: '2', controlledByUserId: 'c1')),
        isFalse,
      );
    });
  });

  group('controllerDocsForTab', () {
    final List<PickingListItem> list = <PickingListItem>[
      _doc(id: '1'),
      _doc(id: '2', controlledByUserId: 'c1'),
      _doc(id: '3'),
    ];

    test('queue tab keeps only unclaimed documents', () {
      final List<PickingListItem> queue = controllerDocsForTab(list, mine: false);
      expect(queue.map((PickingListItem e) => e.id), <String>['1', '3']);
    });

    test('mine tab keeps only claimed documents', () {
      final List<PickingListItem> mine = controllerDocsForTab(list, mine: true);
      expect(mine.map((PickingListItem e) => e.id), <String>['2']);
    });

    test('every document lands in exactly one tab', () {
      final int queue = controllerDocsForTab(list, mine: false).length;
      final int mine = controllerDocsForTab(list, mine: true).length;
      expect(queue + mine, list.length);
    });
  });

  group('controllerCanReleaseToQueue', () {
    test('claimed but not yet scanned can be released', () {
      expect(
        controllerCanReleaseToQueue(_doc(id: '1', controlledByUserId: 'c1')),
        isTrue,
      );
    });

    test('verification already started cannot be released', () {
      expect(
        controllerCanReleaseToQueue(
          _doc(
            id: '2',
            controlledByUserId: 'c1',
            controllerVerificationStartedAt: '2026-07-23T10:05:00Z',
          ),
        ),
        isFalse,
      );
    });

    test('queued document has nothing to release', () {
      expect(controllerCanReleaseToQueue(_doc(id: '3')), isFalse);
    });
  });

  group('PickingListItem json', () {
    test('parses controller_verification_started_at', () {
      final PickingListItem item = PickingListItem.fromJson(<String, Object?>{
        'id': 'd1',
        'reference_number': 'SO-1',
        'status': 'picked',
        'lines_total': 2,
        'lines_done': 2,
        'picked_any': true,
        'controlled_by_user_id': 'c1',
        'sent_to_controller_at': '2026-07-23T10:00:00Z',
        'controller_verification_started_at': '2026-07-23T10:05:00Z',
      });
      expect(item.controllerVerificationStartedAt, '2026-07-23T10:05:00Z');
      expect(controllerDocIsInQueue(item), isFalse);
    });

    test('missing controller_verification_started_at stays null', () {
      final PickingListItem item = PickingListItem.fromJson(<String, Object?>{
        'id': 'd2',
        'reference_number': 'SO-2',
        'status': 'picked',
        'lines_total': 1,
        'lines_done': 1,
        'picked_any': true,
        'sent_to_controller_at': '2026-07-23T10:00:00Z',
      });
      expect(item.controllerVerificationStartedAt, isNull);
      expect(controllerDocIsInQueue(item), isTrue);
    });
  });

  group('controllerDocsForSourceGroup', () {
    final List<PickingListItem> list = <PickingListItem>[
      _doc(id: '1'),
      _doc(id: '2', sourceGroup: kSourceGroupRegion),
      _doc(id: '3', controlledByUserId: 'c1', sourceGroup: kSourceGroupRegion),
      _doc(id: '4', controlledByUserId: 'c1'),
    ];

    test('city tab keeps only city documents', () {
      expect(
        controllerDocsForSourceGroup(list, kSourceGroupCity)
            .map((PickingListItem e) => e.id),
        <String>['1', '4'],
      );
    });

    test('region tab keeps only region documents', () {
      expect(
        controllerDocsForSourceGroup(list, kSourceGroupRegion)
            .map((PickingListItem e) => e.id),
        <String>['2', '3'],
      );
    });

    test('every document lands in exactly one source tab', () {
      final int city = controllerDocsForSourceGroup(list, kSourceGroupCity).length;
      final int region = controllerDocsForSourceGroup(list, kSourceGroupRegion).length;
      expect(city + region, list.length);
    });

    test('source and queue tabs combine', () {
      final List<PickingListItem> regionQueue = controllerDocsForTab(
        controllerDocsForSourceGroup(list, kSourceGroupRegion),
        mine: false,
      );
      expect(regionQueue.map((PickingListItem e) => e.id), <String>['2']);
    });
  });

  group('normalizeSourceGroup', () {
    test('region stays region', () {
      expect(normalizeSourceGroup('region'), kSourceGroupRegion);
    });

    test('missing or unknown value falls back to city so nothing disappears', () {
      expect(normalizeSourceGroup(null), kSourceGroupCity);
      expect(normalizeSourceGroup('shahar'), kSourceGroupCity);
      expect(normalizeSourceGroup('kosmos'), kSourceGroupCity);
    });

    test('json without source_group parses as city', () {
      final PickingListItem item = PickingListItem.fromJson(<String, Object?>{
        'id': 'd9',
        'reference_number': 'SO-9',
        'status': 'picked',
        'lines_total': 1,
        'lines_done': 1,
        'picked_any': true,
        'sent_to_controller_at': '2026-07-23T10:00:00Z',
      });
      expect(item.sourceGroup, kSourceGroupCity);
    });

    test('json with region source_group parses as region', () {
      final PickingListItem item = PickingListItem.fromJson(<String, Object?>{
        'id': 'd10',
        'reference_number': 'SO-10',
        'status': 'picked',
        'lines_total': 1,
        'lines_done': 1,
        'picked_any': true,
        'source_group': 'region',
        'sent_to_controller_at': '2026-07-23T10:00:00Z',
      });
      expect(item.sourceGroup, kSourceGroupRegion);
    });
  });
}
