import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/picking/data/picking_models.dart';
import 'package:mobile_flutter/features/picking/domain/profile_type_param.dart';
import 'package:mobile_flutter/features/picking/presentation/pick_task_list_screen.dart';

PickingListItem _item({
  required String status,
  required int linesTotal,
  required int linesDone,
  required bool pickedAny,
  String? controlledByUserId,
  String? sentToControllerAt,
}) {
  return PickingListItem(
    id: 'd1',
    referenceNumber: 'SO-1',
    status: status,
    linesTotal: linesTotal,
    linesDone: linesDone,
    pickedAny: pickedAny,
    controlledByUserId: controlledByUserId,
    assignedToUserId: 'p1',
    assignedToUserName: 'Picker',
    orderNumber: '100323',
    deliveryNumber: null,
    sentToControllerAt: sentToControllerAt,
  );
}

void main() {
  group('pickerCanSendToController', () {
    test('all-VIP-info picked order (nothing picked) is sendable', () {
      // Hamma qator VIP-info: pickedAny=false, lekin linesDone==linesTotal, picked.
      final PickingListItem item = _item(
        status: 'picked',
        linesTotal: 2,
        linesDone: 2,
        pickedAny: false,
      );
      expect(pickerCanSendToController(item, PickerProfileParam.picker), isTrue);
    });

    test('normal order with something picked is sendable', () {
      final PickingListItem item = _item(
        status: 'picked',
        linesTotal: 3,
        linesDone: 3,
        pickedAny: true,
      );
      expect(pickerCanSendToController(item, PickerProfileParam.picker), isTrue);
    });

    test('all-VIP-info but not yet completed (in_progress) is NOT sendable', () {
      final PickingListItem item = _item(
        status: 'in_progress',
        linesTotal: 2,
        linesDone: 2,
        pickedAny: false,
      );
      expect(pickerCanSendToController(item, PickerProfileParam.picker), isFalse);
    });

    test('partially picked (not fully done, nothing picked yet) is NOT sendable', () {
      final PickingListItem item = _item(
        status: 'picked',
        linesTotal: 3,
        linesDone: 1,
        pickedAny: false,
      );
      expect(pickerCanSendToController(item, PickerProfileParam.picker), isFalse);
    });

    test('already sent to the queue is NOT sendable again', () {
      final PickingListItem item = _item(
        status: 'picked',
        linesTotal: 2,
        linesDone: 2,
        pickedAny: false,
        sentToControllerAt: '2026-07-23T10:00:00Z',
      );
      expect(pickerCanSendToController(item, PickerProfileParam.picker), isFalse);
    });

    test('controlledBy alone does not block: the queue flag decides', () {
      // Navbatga tushmagan (sentToControllerAt=null) hujjat hali yuborilmagan hisoblanadi.
      final PickingListItem item = _item(
        status: 'picked',
        linesTotal: 2,
        linesDone: 2,
        pickedAny: true,
        controlledByUserId: 'c1',
      );
      expect(pickerCanSendToController(item, PickerProfileParam.picker), isTrue);
    });

    test('controller profile never sends', () {
      final PickingListItem item = _item(
        status: 'picked',
        linesTotal: 2,
        linesDone: 2,
        pickedAny: true,
      );
      expect(
        pickerCanSendToController(item, PickerProfileParam.controller),
        isFalse,
      );
    });
  });
}
