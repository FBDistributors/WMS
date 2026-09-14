import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/dealer_counts/data/dealer_counts_models.dart';

DealerSheetLine _line(String key, {String? lineId, String? pid, String? sku, String bc = '', double? qty, double? snap, String? loc, String? brief}) =>
    DealerSheetLine(
      key: key,
      lineId: lineId ?? 'l-$key',
      productId: pid,
      sku: sku,
      productName: 'P $key',
      barcode: bc,
      snapshotQty: snap,
      qty: qty,
      expiryDate: null,
      countedAt: qty != null ? '2026-09-14T10:00:00Z' : null,
      locationCode: loc,
      entriesBrief: brief,
    );

DealerSheetDraft _sheet(List<DealerSheetLine> lines) =>
    DealerSheetDraft(countId: 'c1', dealerOrgId: 'o', dealerName: 'D', downloadedAt: '', lines: lines);

DealerCount _server(List<Map<String, Object?>> lines, {bool active = true}) => DealerCount.fromJson(<String, Object?>{
      'id': 'c1',
      'dealer_org_id': 'o',
      'dealer_name': 'D',
      'is_active': active,
      'created_at': '',
      'total_units': 0,
      'lines': lines,
    });

Map<String, Object?> _srv(String id, String pid, {Object? qty, String? loc, String? by, String? brief}) => <String, Object?>{
      'id': id,
      'product_id': pid,
      'sku': 'S$pid',
      'product_name': 'N$pid',
      'scanned_barcode': 'b$pid',
      'qty': qty,
      'location_code': loc,
      'counted_by_name': by,
      'entries_brief': brief,
      'counted_at': qty != null ? '2026-09-14T11:00:00Z' : null,
      'seq': 1,
    };

void main() {
  test('monthStartIso va normLocation — server bilan bir xil', () {
    expect(monthStartIso(DateTime(2027, 3, 15)), '2027-03-01');
    expect(normLocation('  a-3 '), 'A-3');
    expect(normLocation('sovuq   zona'), 'SOVUQ ZONA');
    expect(normLocation('   '), isNull);
  });

  test('progress va filtrlar (joy bo\'yicha qidiruv ham)', () {
    final DealerSheetDraft s = _sheet(<DealerSheetLine>[
      _line('a', pid: 'p1', sku: 'A1', qty: 5, loc: 'A-3'),
      _line('b', pid: 'p2', sku: 'B1', bc: '460'),
      _line('c', pid: 'p3', sku: 'C1', qty: 0),
    ]);
    expect(<num>[s.countedCount, s.uncountedCount, s.countedUnits], <num>[2, 1, 5]);
    expect(s.filtered(SheetFilter.uncounted, '').map((DealerSheetLine l) => l.key), <String>['b']);
    expect(s.filtered(SheetFilter.all, 'a-3').single.key, 'a');
  });

  test('skan qaysi qatorga: shu joydagi, bo\'lmasa sanalmagan joysiz, bo\'lmasa yangi', () {
    bool p1(DealerSheetLine l) => l.productId == 'p1';
    final DealerSheetDraft s = _sheet(<DealerSheetLine>[_line('free', pid: 'p1'), _line('b2', pid: 'p1', qty: 3, loc: 'B-2')]);
    expect(s.lineForScan(p1, 'b-2')?.key, 'b2');
    expect(s.lineForScan(p1, 'A-1')?.key, 'free');
    final DealerSheetDraft t = _sheet(<DealerSheetLine>[_line('a1', pid: 'p1', qty: 4, loc: 'A-1')]);
    expect(t.lineForScan(p1, 'B-2'), isNull);
  });

  group('qayta skanda qo\'shish', () {
    test('qo\'shish oldingi songa qo\'shiladi, serverga qo\'shimcha (jami emas) ketadi', () {
      final DealerSheetLine a = _line('a', pid: 'p1', qty: 12);
      final DealerSheetDraft s = _sheet(<DealerSheetLine>[a]);
      final PendingOp op = s.addOp(a, mode: 'add', qty: 5, expiry: null, location: null);
      expect(a.qty, 17);
      expect(a.breakdown, '12 + 5');
      final entries = s.pendingSnapshot().entries;
      expect(entries.single['mode'], 'add');
      expect(entries.single['qty'], 5);
      expect(entries.single['op_id'], op.opId);
      expect(entries.single['line_id'], 'l-a');
    });

    test('tuzatish (jami) avvalgi qo\'shishlarni almashtiradi', () {
      final DealerSheetLine a = _line('a', pid: 'p1', qty: 12);
      final DealerSheetDraft s = _sheet(<DealerSheetLine>[a]);
      s.addOp(a, mode: 'add', qty: 5, expiry: null, location: null);
      s.addOp(a, mode: 'set', qty: 15, expiry: null, location: null);
      s.addOp(a, mode: 'add', qty: 2, expiry: null, location: null);
      expect(a.qty, 17);
      expect(a.breakdown, '15 + 2');
      expect(s.pendingSnapshot().entries.map((Map<String, Object?> e) => e['mode']), <String>['add', 'set', 'add']);
    });

    test('bekor qilish: yuborilmagan — navbatdan olinadi; yuborilgan — undo kiritishi ketadi', () {
      final DealerSheetLine a = _line('a', pid: 'p1', qty: 12);
      final DealerSheetDraft s = _sheet(<DealerSheetLine>[a]);
      final PendingOp first = s.addOp(a, mode: 'add', qty: 5, expiry: null, location: null);
      s.undoAdd(a, first);
      expect(a.qty, 12);
      expect(a.dirty, isFalse);

      final PendingOp second = s.addOp(a, mode: 'add', qty: 4, expiry: null, location: null);
      final snap = s.pendingSnapshot();
      s.markSynced(snap.opIds);
      s.mergeServer(_server(<Map<String, Object?>>[_srv('l-a', 'p1', qty: 16, brief: '12 + 4')]));
      final DealerSheetLine live = s.lines.single;
      expect(live.qty, 16);
      s.undoAdd(live, second);
      expect(live.qty, 12);
      final Map<String, Object?> undo = s.pendingSnapshot().entries.single;
      expect(undo['mode'], 'undo');
      expect(undo['undo_op_id'], second.opId);
      expect(undo.containsKey('qty'), isFalse);
    });

    test('yuborish paytida qo\'shilgan kiritish navbatda qoladi', () {
      final DealerSheetLine a = _line('a', pid: 'p1', qty: 12);
      final DealerSheetDraft s = _sheet(<DealerSheetLine>[a]);
      s.addOp(a, mode: 'add', qty: 5, expiry: null, location: null);
      final snap = s.pendingSnapshot();
      s.addOp(a, mode: 'add', qty: 1, expiry: null, location: null); // javob kutilayotganda
      s.markSynced(snap.opIds);
      expect(a.pending.single.qty, 1);
      // Server 17 (12+5) ni qaytardi — ustiga navbatdagi +1.
      s.mergeServer(_server(<Map<String, Object?>>[_srv('l-a', 'p1', qty: 17, brief: '12 + 5')]));
      expect(s.lines.single.qty, 18);
      expect(s.lines.single.breakdown, '12 + 5 + 1');
    });
  });

  group('server bilan birlashtirish', () {
    test('boshqalar sanagani keladi, yuborilmagan yangi qator server qatoriga bog\'lanadi', () {
      final DealerSheetLine mine = _line('m', lineId: 'l1', pid: 'p1');
      final DealerSheetDraft s = _sheet(<DealerSheetLine>[mine, _line('x', lineId: 'l2', pid: 'p2')]);
      s.addOp(mine, mode: 'set', qty: 9, expiry: null, location: null);
      final DealerSheetLine added = DealerSheetLine(
        key: 'new', lineId: null, productId: 'p2', sku: null, productName: 'x', barcode: '', snapshotQty: null,
        qty: null, expiryDate: null, countedAt: null,
      );
      s.lines.add(added);
      s.addOp(added, mode: 'set', qty: 2, expiry: null, location: 'B-2');
      s.mergeServer(_server(<Map<String, Object?>>[
        _srv('l1', 'p1', qty: 4, by: 'Ali'),
        _srv('l2', 'p2', qty: 7, by: 'Ali'),
        _srv('l3', 'p2', qty: 1, loc: 'B-2'),
      ]));
      expect(s.lines.length, 3);
      final Map<String, DealerSheetLine> byId = <String, DealerSheetLine>{for (final DealerSheetLine l in s.lines) l.lineId!: l};
      expect(byId['l1']!.qty, 9); // navbatdagi jami ustida
      expect(byId['l2']!.qty, 7);
      expect(byId['l2']!.countedByName, 'Ali');
      expect(identical(byId['l3'], added), isTrue);
      expect(byId['l3']!.qty, 2);
    });

    test('web\'dan o\'chirilgan qator telefondan ham ketadi', () {
      final DealerSheetLine gone = _line('g', lineId: 'l9', pid: 'p9');
      final DealerSheetDraft s = _sheet(<DealerSheetLine>[gone]);
      s.addOp(gone, mode: 'set', qty: 1, expiry: null, location: null);
      s.mergeServer(_server(<Map<String, Object?>>[_srv('l1', 'p1')]));
      expect(s.lines.map((DealerSheetLine l) => l.lineId), <String?>['l1']);
    });
  });

  test('JSON aylanishi: navbat, joy, egasi, hozirgi joy', () {
    final DealerSheetLine a = _line('a', pid: 'p1', sku: 'A', bc: '1', snap: 10, qty: 3, brief: null);
    final DealerSheetDraft s = DealerSheetDraft(
      countId: 'c9', dealerOrgId: 'o', dealerName: 'D', downloadedAt: 't', lines: <DealerSheetLine>[a],
      ownerUserId: 'u1', currentLocation: 'A-3',
    );
    s.addOp(a, mode: 'add', qty: 2, expiry: '2027-03-01', location: 'A-3');
    final DealerSheetDraft back = DealerSheetDraft.fromJson(s.toJson());
    final DealerSheetLine l = back.lines.single;
    expect(<Object?>[l.baseQty, l.qty, l.snapshotQty, l.locationCode, l.expiryDate, l.pending.single.mode], <Object?>[3, 5, 10, 'A-3', '2027-03-01', 'add']);
    expect(back.currentLocation, 'A-3');
    expect(back.belongsTo('u2'), isFalse);
  });

  test('1.0.48 nusxasi: yuborilmagan (dirty) jami navbatga "set" bo\'lib o\'tadi', () {
    final DealerSheetDraft back = DealerSheetDraft.fromJson(<String, Object?>{
      'kind': 'sheet',
      'count_id': 'c1',
      'dealer_org_id': 'o',
      'lines': <Map<String, Object?>>[
        <String, Object?>{'key': 'a', 'line_id': 'l1', 'qty': 2, 'counted_at': '2026-09-14T10:00:00Z', 'dirty': true},
        <String, Object?>{'key': 'b', 'line_id': 'l2', 'qty': 7, 'dirty': false},
      ],
    });
    expect(back.pendingCount, 1);
    expect(back.lines.first.qty, 2);
    expect(back.lines.first.pending.single.mode, 'set');
    expect(back.lines.last.qty, 7);
    expect(back.lines.last.dirty, isFalse);
  });

  test('serverdan kelgan sanov -> nusxa (faol belgisi, joy, kim sanadi, kiritishlar)', () {
    final DealerCount c = _server(<Map<String, Object?>>[
      _srv('l1', 'p1'),
      _srv('l2', 'p2', qty: 4, loc: 'A-1', by: 'Ali', brief: '3 + 1'),
    ], active: false);
    expect(c.isActive, isFalse);
    final DealerSheetDraft s = DealerSheetDraft.fromCount(c, ownerUserId: 'u1');
    expect(<Object?>[s.uncountedCount, s.pendingCount, s.lines.last.locationCode, s.lines.last.breakdown], <Object?>[1, 0, 'A-1', '3 + 1']);
  });
}
