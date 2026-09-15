import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/dealer_counts/data/dealer_counts_models.dart';

DealerCountLine _line(String id, {String? pid, String? sku, String bc = '', double? qty, String? loc, String? brief}) =>
    DealerCountLine(
      id: id,
      productId: pid,
      sku: sku,
      productName: 'P $id',
      scannedBarcode: bc,
      qty: qty,
      expiryDate: null,
      seq: 1,
      locationCode: loc,
      entriesBrief: brief,
    );

void main() {
  test('monthStartIso va normLocation — server bilan bir xil', () {
    expect(monthStartIso(DateTime(2027, 3, 15)), '2027-03-01');
    expect(normLocation('  a-3 '), 'A-3');
    expect(normLocation('sovuq   zona'), 'SOVUQ ZONA');
    expect(normLocation('   '), isNull);
  });

  test('progress va filtrlar (joy bo\'yicha qidiruv ham)', () {
    final DealerSheet s = DealerSheet(countId: 'c1', dealerName: 'D', lines: <DealerCountLine>[
      _line('a', pid: 'p1', sku: 'A1', qty: 5, loc: 'A-3'),
      _line('b', pid: 'p2', sku: 'B1', bc: '460'),
      _line('c', pid: 'p3', sku: 'C1', qty: 0),
    ]);
    expect(<num>[s.countedCount, s.uncountedCount, s.countedUnits], <num>[2, 1, 5]);
    expect(s.filtered(SheetFilter.uncounted, '').map((DealerCountLine l) => l.id), <String>['b']);
    expect(s.filtered(SheetFilter.all, 'a-3').single.id, 'a');
    expect(s.filtered(SheetFilter.all, '460').single.id, 'b');
  });

  test('skan qaysi qatorga: shu joydagi, bo\'lmasa sanalmagan joysiz, bo\'lmasa null (server yangi ochadi)', () {
    bool p1(DealerCountLine l) => l.productId == 'p1';
    final DealerSheet s = DealerSheet(countId: 'c', dealerName: 'D', lines: <DealerCountLine>[
      _line('free', pid: 'p1'),
      _line('b2', pid: 'p1', qty: 3, loc: 'B-2'),
    ]);
    expect(s.lineForScan(p1, 'b-2')?.id, 'b2');
    expect(s.lineForScan(p1, 'A-1')?.id, 'free');
    final DealerSheet t = DealerSheet(countId: 'c', dealerName: 'D', lines: <DealerCountLine>[_line('a1', pid: 'p1', qty: 4, loc: 'A-1')]);
    expect(t.lineForScan(p1, 'B-2'), isNull);
  });

  test('serverdan o\'zgargan qatorlar: borlari almashadi, yangilari qo\'shiladi; o\'chirilgan qator bilinadi', () {
    final DealerSheet s = DealerSheet(countId: 'c', dealerName: 'D', lines: <DealerCountLine>[_line('a', pid: 'p1'), _line('b', pid: 'p2')]);
    s.applyLines(<DealerCountLine>[
      _line('a', pid: 'p1', qty: 17, brief: '12 + 5'),
      _line('n', pid: 'p2', qty: 2, loc: 'B-2'), // boshqa joyda — server yangi qator ochgan
    ], sheetLines: 3);
    expect(s.lines.map((DealerCountLine l) => l.id), <String>['a', 'b', 'n']);
    expect(s.lines.first.qty, 17);
    expect(s.lines.first.entriesBrief, '12 + 5');
    expect(s.outOfSync, isFalse);
    // Web'da bitta qator o'chirildi: serverda 2 ta, ekranda 3 ta — to'liq qayta yuklash kerak.
    s.applyLines(const <DealerCountLine>[], sheetLines: 2);
    expect(s.outOfSync, isTrue);
  });

  test('kiritish yozuvi: op_id, rejim, joy; bekor qilishda miqdor yo\'q', () {
    final Map<String, Object?> add = dealerCountEntry(opId: 'o1', mode: 'add', qty: 5, lineId: 'l1', productId: 'p1', locationCode: 'A-3');
    expect(<Object?>[add['op_id'], add['mode'], add['qty'], add['line_id'], add['location_code']], <Object?>['o1', 'add', 5.0, 'l1', 'A-3']);
    expect(add['counted_at'], isNotNull);
    final Map<String, Object?> undo = dealerCountEntry(opId: 'o2', mode: 'undo', undoOpId: 'o1');
    expect(undo['undo_op_id'], 'o1');
    expect(undo.containsKey('qty'), isFalse);
  });

  test('o\'zgarganlar javobi o\'qiladi', () {
    final DealerChangedLines r = DealerChangedLines.fromJson(<String, Object?>{
      'id': 'c1',
      'dealer_org_id': 'o',
      'dealer_name': 'Дилер',
      'is_active': false,
      'sheet_lines': 3808,
      'counted_lines': 5,
      'total_units': '17',
      'server_time': '2026-09-15T10:00:00Z',
      'lines': <Map<String, Object?>>[
        <String, Object?>{'id': 'l1', 'product_id': 'p1', 'scanned_barcode': '1', 'qty': '17', 'entries_brief': '12 + 5', 'seq': 1},
      ],
    });
    expect(<Object?>[r.dealerName, r.isActive, r.sheetLines, r.totalUnits, r.serverTime], <Object?>['Дилер', false, 3808, 17.0, '2026-09-15T10:00:00Z']);
    expect(r.lines.single.qty, 17);
  });

  group('eski telefon nusxalari (1.0.49 gacha) — bir marta yuboriladi', () {
    test('1.0.49: navbatdagi kiritishlar o\'z op_id lari bilan', () {
      final legacy = legacyDraftEntries(<String, Object?>{
        'kind': 'sheet',
        'count_id': 'c1',
        'lines': <Map<String, Object?>>[
          <String, Object?>{
            'key': 'a',
            'line_id': 'l1',
            'product_id': 'p1',
            'barcode': '46',
            'location_code': 'A-3',
            'pending': <Map<String, Object?>>[
              <String, Object?>{'op_id': 'x1', 'mode': 'add', 'qty': 5, 'counted_at': 't1'},
              <String, Object?>{'op_id': 'x2', 'mode': 'undo', 'qty': 5, 'undo_op_id': 'x1', 'counted_at': 't2'},
            ],
          },
          <String, Object?>{'key': 'b', 'line_id': 'l2', 'pending': <Object?>[]},
        ],
      })!;
      expect(legacy.countId, 'c1');
      expect(legacy.entries.map((Map<String, Object?> e) => e['op_id']), <String>['x1', 'x2']);
      expect(legacy.entries.first['qty'], 5);
      expect(legacy.entries.first['location_code'], 'A-3');
      expect(legacy.entries.last['undo_op_id'], 'x1');
      expect(legacy.entries.last.containsKey('qty'), isFalse);
    });

    test('1.0.48 (dirty) va undan eski (sanalgan) — jami kiritishi; sanalmaganlar yuborilmaydi', () {
      final legacy = legacyDraftEntries(<String, Object?>{
        'kind': 'sheet',
        'count_id': 'c2',
        'lines': <Map<String, Object?>>[
          <String, Object?>{'key': 'a', 'line_id': 'l1', 'qty': 2, 'dirty': true, 'counted_at': 't'},
          <String, Object?>{'key': 'b', 'line_id': 'l2', 'qty': 7, 'dirty': false},
          <String, Object?>{'key': 'c', 'line_id': 'l3', 'qty': 4, 'counted_at': 't'}, // 1.0.47
          <String, Object?>{'key': 'd', 'line_id': 'l4', 'qty': null},
        ],
      })!;
      expect(legacy.entries.map((Map<String, Object?> e) => e['line_id']), <String>['l1', 'l3']);
      expect(legacy.entries.every((Map<String, Object?> e) => e['mode'] == 'set' && e['op_id'] != null), isTrue);
    });

    test('nusxa bo\'lmagan yozuv (eski bo\'sh draft) — null', () {
      expect(legacyDraftEntries(<String, Object?>{'client_uuid': 'u1', 'lines': <Object?>[]}), isNull);
    });
  });
}
