import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/dealer_counts/data/dealer_counts_models.dart';

DealerCountDraft _draft() => DealerCountDraft(
      clientUuid: 'cu-1',
      dealerOrgId: '8109107',
      dealerName: 'Дилер Test',
      startedAt: '2026-09-11T05:00:00Z',
      lines: <DealerCountDraftLine>[],
    );

void main() {
  _sheetTests();
  group('DealerCountDraft.addScan', () {
    test('bir xil mahsulot + bir xil muddat — miqdor qo‘shiladi', () {
      final DealerCountDraft d = _draft();
      d.addScan(key: 'a', productId: 'p1', productName: 'X', scannedBarcode: '1', qty: 5, expiryDate: '2027-03-01', scannedAt: '');
      d.addScan(key: 'b', productId: 'p1', productName: 'X', scannedBarcode: '1', qty: 7, expiryDate: '2027-03-01', scannedAt: '');
      expect(d.lines.length, 1);
      expect(d.lines.first.qty, 12);
      expect(d.totalUnits, 12);
    });

    test('boshqa muddat — alohida qator', () {
      final DealerCountDraft d = _draft();
      d.addScan(key: 'a', productId: 'p1', productName: 'X', scannedBarcode: '1', qty: 5, expiryDate: '2027-03-01', scannedAt: '');
      d.addScan(key: 'b', productId: 'p1', productName: 'X', scannedBarcode: '1', qty: 7, expiryDate: null, scannedAt: '');
      expect(d.lines.length, 2);
    });

    test('tanilmagan skan har doim yangi qator', () {
      final DealerCountDraft d = _draft();
      d.addScan(key: 'a', productId: null, productName: null, scannedBarcode: '000', qty: 1, expiryDate: null, scannedAt: '');
      d.addScan(key: 'b', productId: null, productName: null, scannedBarcode: '000', qty: 1, expiryDate: null, scannedAt: '');
      expect(d.lines.length, 2);
      expect(d.lines.every((DealerCountDraftLine l) => l.isUnknown), isTrue);
    });
  });

  test('draft JSON aylanishi (telefonda saqlash) yo‘qotishsiz', () {
    final DealerCountDraft d = _draft();
    d.note = 'izoh';
    d.addScan(key: 'a', productId: 'p1', productName: 'X', scannedBarcode: '1', qty: 3, expiryDate: '2027-03-01', scannedAt: 't');
    final DealerCountDraft back = DealerCountDraft.fromJson(d.toJson());
    expect(back.clientUuid, 'cu-1');
    expect(back.dealerName, 'Дилер Test');
    expect(back.note, 'izoh');
    expect(back.lines.single.productId, 'p1');
    expect(back.lines.single.qty, 3);
    expect(back.lines.single.expiryDate, '2027-03-01');
  });

  test('serverga yuboriladigan shakl: product_id yo‘q bo‘lsa yuborilmaydi, submit bayrog‘i', () {
    final DealerCountDraft d = _draft();
    d.addScan(key: 'a', productId: null, productName: null, scannedBarcode: '000', qty: 2, expiryDate: null, scannedAt: '');
    final Map<String, Object?> api = d.toApiJson(submit: true);
    expect(api['submit'], isTrue);
    expect(api['client_uuid'], 'cu-1');
    final Map<String, Object?> line = (api['lines'] as List).single as Map<String, Object?>;
    expect(line.containsKey('product_id'), isFalse);
    expect(line['scanned_barcode'], '000');
    expect(line['qty'], 2);
  });

  test('monthStartIso oy boshiga keltiradi', () {
    expect(monthStartIso(DateTime(2027, 3, 15)), '2027-03-01');
    expect(monthStartIso(DateTime(2026, 12, 31)), '2026-12-01');
  });
}

void _sheetTests() {
  DealerSheetLine line(String key, {String? pid, String? sku, String bc = '', double? qty, double? snap}) =>
      DealerSheetLine(
        key: key,
        lineId: 'l-$key',
        productId: pid,
        sku: sku,
        productName: 'P $key',
        barcode: bc,
        snapshotQty: snap,
        qty: qty,
        expiryDate: null,
        countedAt: null,
      );

  group('DealerSheetDraft', () {
    test('progress va filtrlar', () {
      final DealerSheetDraft s = DealerSheetDraft(
        countId: 'c1',
        dealerOrgId: 'o',
        dealerName: 'D',
        downloadedAt: '',
        lines: <DealerSheetLine>[
          line('a', pid: 'p1', sku: 'A1', qty: 5),
          line('b', pid: 'p2', sku: 'B1', bc: '460'),
          line('c', pid: 'p3', sku: 'C1', qty: 0),
        ],
      );
      expect(s.countedCount, 2);
      expect(s.uncountedCount, 1);
      expect(s.countedUnits, 5);
      expect(s.filtered(SheetFilter.uncounted, '').map((DealerSheetLine l) => l.key), <String>['b']);
      expect(s.filtered(SheetFilter.counted, '').length, 2);
      expect(s.filtered(SheetFilter.all, '460').single.key, 'b');
      expect(s.filtered(SheetFilter.all, 'p c').single.key, 'c');
      expect(s.findByProduct('p2')?.key, 'b');
      expect(s.findByProduct('zzz'), isNull);
    });

    test('countEntries faqat sanalganlar, 0 ham kiradi', () {
      final DealerSheetDraft s = DealerSheetDraft(
        countId: 'c1',
        dealerOrgId: 'o',
        dealerName: 'D',
        downloadedAt: '',
        lines: <DealerSheetLine>[line('a', pid: 'p1', qty: 5), line('b', pid: 'p2'), line('c', pid: 'p3', qty: 0)],
      );
      final List<Map<String, Object?>> e = s.countEntries();
      expect(e.length, 2);
      expect(e.first['line_id'], 'l-a');
      expect(e.first['qty'], 5);
      expect(e.last['qty'], 0);
    });

    test('JSON aylanishi (kind: sheet) yoqotishsiz', () {
      final DealerSheetDraft s = DealerSheetDraft(
        countId: 'c9',
        dealerOrgId: 'o',
        dealerName: 'D',
        downloadedAt: 't',
        lines: <DealerSheetLine>[line('a', pid: 'p1', sku: 'A', bc: '1', qty: 3, snap: 10)],
      );
      final Map<String, Object?> j = s.toJson();
      expect(j['kind'], 'sheet');
      final DealerSheetDraft back = DealerSheetDraft.fromJson(j);
      expect(back.countId, 'c9');
      expect(back.lines.single.snapshotQty, 10);
      expect(back.lines.single.qty, 3);
      expect(back.lines.single.lineId, 'l-a');
    });

    test('serverdan kelgan sanov -> nusxa (qty null sanalmagan)', () {
      final DealerCount c = DealerCount.fromJson(<String, Object?>{
        'id': 'c1',
        'client_uuid': 'u',
        'dealer_org_id': 'o',
        'dealer_name': 'D',
        'status': 'in_progress',
        'started_at': '',
        'lines_count': 0,
        'total_units': 0,
        'sheet_lines': 2,
        'counted_lines': 0,
        'lines': <Map<String, Object?>>[
          <String, Object?>{'id': 'l1', 'product_id': 'p1', 'sku': 'A', 'product_name': 'PA', 'scanned_barcode': '1', 'qty': null, 'snapshot_qty': '7', 'seq': 1},
          <String, Object?>{'id': 'l2', 'product_id': 'p2', 'sku': 'B', 'product_name': 'PB', 'scanned_barcode': '2', 'qty': 4, 'seq': 2},
        ],
      });
      expect(c.isSheetOpen, isTrue);
      final DealerSheetDraft s = DealerSheetDraft.fromCount(c);
      expect(s.uncountedCount, 1);
      expect(s.lines.first.snapshotQty, 7);
      expect(s.lines.last.qty, 4);
    });
  });
}
