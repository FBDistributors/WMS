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
