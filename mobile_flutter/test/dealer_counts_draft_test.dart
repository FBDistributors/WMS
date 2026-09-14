import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/dealer_counts/data/dealer_counts_models.dart';

DealerSheetLine _line(
  String key, {
  String? lineId,
  String? pid,
  String? sku,
  String bc = '',
  double? qty,
  double? snap,
  String? loc,
  bool dirty = false,
}) =>
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
      dirty: dirty,
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

Map<String, Object?> _srv(String id, String pid, {Object? qty, String? loc, String? by}) => <String, Object?>{
      'id': id,
      'product_id': pid,
      'sku': 'S$pid',
      'product_name': 'N$pid',
      'scanned_barcode': 'b$pid',
      'qty': qty,
      'location_code': loc,
      'counted_by_name': by,
      'counted_at': qty != null ? '2026-09-14T11:00:00Z' : null,
      'seq': 1,
    };

void main() {
  test('monthStartIso oy boshiga keltiradi', () {
    expect(monthStartIso(DateTime(2027, 3, 15)), '2027-03-01');
    expect(monthStartIso(DateTime(2026, 12, 31)), '2026-12-01');
  });

  test('normLocation — server bilan bir xil', () {
    expect(normLocation('  a-3 '), 'A-3');
    expect(normLocation('sovuq   zona'), 'SOVUQ ZONA');
    expect(normLocation('   '), isNull);
    expect(normLocation(null), isNull);
  });

  test('progress va filtrlar (joy bo\'yicha qidiruv ham)', () {
    final DealerSheetDraft s = _sheet(<DealerSheetLine>[
      _line('a', pid: 'p1', sku: 'A1', qty: 5, loc: 'A-3'),
      _line('b', pid: 'p2', sku: 'B1', bc: '460'),
      _line('c', pid: 'p3', sku: 'C1', qty: 0),
    ]);
    expect(s.countedCount, 2);
    expect(s.uncountedCount, 1);
    expect(s.countedUnits, 5);
    expect(s.filtered(SheetFilter.uncounted, '').map((DealerSheetLine l) => l.key), <String>['b']);
    expect(s.filtered(SheetFilter.all, '460').single.key, 'b');
    expect(s.filtered(SheetFilter.all, 'a-3').single.key, 'a');
  });

  group('skan qaysi qatorga yoziladi', () {
    bool p1(DealerSheetLine l) => l.productId == 'p1';

    test('shu joydagi qator, bo\'lmasa ro\'yxatdagi sanalmagan joysiz qator', () {
      final DealerSheetDraft s = _sheet(<DealerSheetLine>[
        _line('free', pid: 'p1'),
        _line('b2', pid: 'p1', qty: 3, loc: 'B-2'),
      ]);
      expect(s.lineForScan(p1, 'b-2')?.key, 'b2');
      expect(s.lineForScan(p1, 'A-1')?.key, 'free');
      expect(s.lineForScan(p1, null)?.key, 'free');
    });

    test('ro\'yxat qatori sanalgan, boshqa joy — yangi qator kerak (null)', () {
      final DealerSheetDraft s = _sheet(<DealerSheetLine>[_line('a1', pid: 'p1', qty: 4, loc: 'A-1')]);
      expect(s.lineForScan(p1, 'B-2'), isNull);
      expect(s.lineForScan(p1, 'A-1')?.key, 'a1');
    });
  });

  group('yuborish va server bilan birlashtirish', () {
    test('faqat yuborilmagan sanalganlar yuboriladi; yuborish paytida o\'zgargani yuborilmagan qoladi', () {
      final DealerSheetLine a = _line('a', pid: 'p1');
      final DealerSheetLine b = _line('b', pid: 'p2');
      final DealerSheetDraft s = _sheet(<DealerSheetLine>[a, b, _line('c', pid: 'p3', qty: 2)]);
      s.markCounted(a, qty: 5, expiry: null, location: 'a-1');
      s.markCounted(b, qty: 0, expiry: null, location: null);
      final snap = s.pendingSnapshot();
      expect(snap.entries.length, 2);
      expect(snap.entries.first['location_code'], 'A-1');
      expect(snap.entries.first['counted_at'], isNotNull);
      expect(snap.entries.last['qty'], 0);
      // Yuborish ketayotganda b qayta sanaldi.
      s.markCounted(b, qty: 1, expiry: null, location: null);
      s.markSynced(snap.versions);
      expect(a.dirty, isFalse);
      expect(b.dirty, isTrue);
      expect(s.pendingCount, 1);
    });

    test('server holati keladi, yuborilmagan o\'zimniki ustida qoladi, takror qator bo\'lmaydi', () {
      final DealerSheetLine mine = _line('m', lineId: 'l1', pid: 'p1');
      final DealerSheetDraft s = _sheet(<DealerSheetLine>[mine, _line('x', lineId: 'l2', pid: 'p2')]);
      s.markCounted(mine, qty: 9, expiry: null, location: null);
      // Telefonda qo'shilgan yangi qator (boshqa joy), serverga yetgan — lineId hali yo'q.
      final DealerSheetLine added = DealerSheetLine(
        key: 'new', lineId: null, productId: 'p2', sku: null, productName: 'x', barcode: '', snapshotQty: null,
        qty: null, expiryDate: null, countedAt: null,
      );
      s.lines.add(added);
      s.markCounted(added, qty: 2, expiry: null, location: 'B-2');
      s.mergeServer(_server(<Map<String, Object?>>[
        _srv('l1', 'p1', qty: 4, by: 'Ali'), // boshqa xodim sanagan, lekin menda yuborilmagan 9 bor
        _srv('l2', 'p2', qty: 7, by: 'Ali'), // boshqa xodim sanagan — keladi
        _srv('l3', 'p2', qty: 2, loc: 'B-2'), // mening yangi qatorim serverda
      ]));
      expect(s.lines.length, 3);
      final Map<String, DealerSheetLine> byId = <String, DealerSheetLine>{for (final DealerSheetLine l in s.lines) l.lineId!: l};
      expect(byId['l1']!.qty, 9);
      expect(byId['l1']!.dirty, isTrue);
      expect(byId['l2']!.qty, 7);
      expect(byId['l2']!.countedByName, 'Ali');
      expect(identical(byId['l3'], added), isTrue); // yangi qator server qatoriga bog'landi
    });

    test('web\'dan o\'chirilgan qator telefondan ham ketadi', () {
      final DealerSheetLine gone = _line('g', lineId: 'l9', pid: 'p9');
      final DealerSheetDraft s = _sheet(<DealerSheetLine>[gone]);
      s.markCounted(gone, qty: 1, expiry: null, location: null);
      s.mergeServer(_server(<Map<String, Object?>>[_srv('l1', 'p1')]));
      expect(s.lines.map((DealerSheetLine l) => l.lineId), <String?>['l1']);
    });
  });

  test('JSON aylanishi: joy, yuborilmagan, versiya, egasi, hozirgi joy', () {
    final DealerSheetLine a = _line('a', pid: 'p1', sku: 'A', bc: '1', snap: 10);
    final DealerSheetDraft s = DealerSheetDraft(
      countId: 'c9',
      dealerOrgId: 'o',
      dealerName: 'D',
      downloadedAt: 't',
      lines: <DealerSheetLine>[a],
      ownerUserId: 'u1',
      currentLocation: 'A-3',
    );
    s.markCounted(a, qty: 3, expiry: '2027-03-01', location: 'A-3');
    final Map<String, Object?> j = s.toJson();
    expect(j['kind'], 'sheet');
    final DealerSheetDraft back = DealerSheetDraft.fromJson(j);
    final DealerSheetLine l = back.lines.single;
    expect(<Object?>[l.qty, l.snapshotQty, l.locationCode, l.expiryDate, l.dirty, l.version], <Object?>[3, 10, 'A-3', '2027-03-01', true, 1]);
    expect(back.currentLocation, 'A-3');
    expect(back.belongsTo('u1'), isTrue);
    expect(back.belongsTo('u2'), isFalse);
  });

  test('eski (1.0.47 gacha) nusxa: sanalgan qator yuborilmagan deb olinadi', () {
    final DealerSheetDraft back = DealerSheetDraft.fromJson(<String, Object?>{
      'kind': 'sheet',
      'count_id': 'c1',
      'dealer_org_id': 'o',
      'lines': <Map<String, Object?>>[
        <String, Object?>{'key': 'a', 'line_id': 'l1', 'qty': 2, 'counted_at': '2026-09-14T10:00:00Z'},
        <String, Object?>{'key': 'b', 'line_id': 'l2', 'qty': null},
      ],
    });
    expect(back.pendingCount, 1);
    expect(back.belongsTo('anyone'), isTrue);
  });

  test('serverdan kelgan sanov -> nusxa (faol belgisi, joy, kim sanadi)', () {
    final DealerCount c = _server(<Map<String, Object?>>[
      _srv('l1', 'p1'),
      _srv('l2', 'p2', qty: 4, loc: 'A-1', by: 'Ali'),
    ], active: false);
    expect(c.isActive, isFalse);
    final DealerSheetDraft s = DealerSheetDraft.fromCount(c, ownerUserId: 'u1');
    expect(s.uncountedCount, 1);
    expect(s.pendingCount, 0);
    expect(s.lines.last.locationCode, 'A-1');
    expect(s.lines.last.countedByName, 'Ali');
    expect(s.ownerUserId, 'u1');
  });
}
