import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/picking/data/picking_models.dart';
import 'package:mobile_flutter/shared/widgets/pick_box_qty_fields.dart';

ConsolidatedLineItem _line({
  required String docId,
  required String ref,
  required double req,
  double picked = 0,
}) {
  return ConsolidatedLineItem(
    documentId: docId,
    lineId: '$docId-line',
    referenceNumber: ref,
    qtyRequired: req,
    qtyPicked: picked,
    locationCode: 'P-01',
    pickSequence: 1,
    expiryDate: null,
  );
}

void main() {
  _consolidatedByOrderAndLocationTests();
  test('applyConsolidatedHybridQtyDefaults 2+ buyurtma buyurtma bo\'yicha', () {
    final TextEditingController boxCount = TextEditingController();
    final TextEditingController looseQty = TextEditingController();
    final List<ConsolidatedLineItem> lines = <ConsolidatedLineItem>[
      _line(docId: 'a', ref: 'A', req: 4),
      _line(docId: 'b', ref: 'B', req: 5),
      _line(docId: 'c', ref: 'C', req: 6),
    ];
    applyConsolidatedHybridQtyDefaults(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 8,
      maxUnits: 15,
      lines: lines,
    );
    expect(boxCount.text, '0');
    expect(looseQty.text, '15');
    boxCount.dispose();
    looseQty.dispose();
  });

  test('applyConsolidatedHybridQtyDefaults bitta buyurtmada jami mantiq', () {
    final TextEditingController boxCount = TextEditingController();
    final TextEditingController looseQty = TextEditingController();
    final List<ConsolidatedLineItem> lines = <ConsolidatedLineItem>[
      _line(docId: 'a', ref: 'A', req: 17),
    ];
    applyConsolidatedHybridQtyDefaults(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 8,
      maxUnits: 17,
      lines: lines,
    );
    expect(boxCount.text, '2');
    expect(looseQty.text, '1');
    boxCount.dispose();
    looseQty.dispose();
  });

  test('applyConsolidatedHybridQtyDefaults loose-only ignores API suggested', () {
    final TextEditingController boxCount = TextEditingController();
    final TextEditingController looseQty = TextEditingController();
    final List<ConsolidatedLineItem> lines = <ConsolidatedLineItem>[
      _line(docId: 'a', ref: 'A', req: 6),
    ];
    applyConsolidatedHybridQtyDefaults(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 8,
      maxUnits: 6,
      lines: lines,
      suggestedBoxCount: 1,
      suggestedLooseQty: 1,
      stockBoxCount: 0,
      stockLooseUnits: 953,
    );
    expect(boxCount.text, '0');
    expect(looseQty.text, '6');
    boxCount.dispose();
    looseQty.dispose();
  });

  test('applyConsolidatedHybridQtyDefaults API suggested ustun', () {
    final TextEditingController boxCount = TextEditingController();
    final TextEditingController looseQty = TextEditingController();
    final List<ConsolidatedLineItem> lines = <ConsolidatedLineItem>[
      _line(docId: 'a', ref: 'A', req: 4),
      _line(docId: 'b', ref: 'B', req: 5),
      _line(docId: 'c', ref: 'C', req: 8),
    ];
    applyConsolidatedHybridQtyDefaults(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: 8,
      maxUnits: 17,
      lines: lines,
      suggestedBoxCount: 1,
      suggestedLooseQty: 9,
    );
    expect(boxCount.text, '1');
    expect(looseQty.text, '9');
    boxCount.dispose();
    looseQty.dispose();
  });
}

ConsolidatedLineItem _srcLine({
  required String ref,
  required double req,
  double picked = 0,
  String loc = 'P-01',
  String? source,
}) {
  return ConsolidatedLineItem(
    documentId: 'doc-$ref',
    lineId: 'line-$ref-$req-$source',
    referenceNumber: ref,
    qtyRequired: req,
    qtyPicked: picked,
    locationCode: loc,
    pickSequence: 1,
    expiryDate: null,
    lineSource: source,
  );
}

void _consolidatedByOrderAndLocationTests() {
  group('consolidatedOpenLinesByOrderText buyurtma bo‘yicha yig‘adi', () {
    test('bir buyurtmaning oddiy va aksiya qatori bitta yozuvga yig‘iladi', () {
      final String out = consolidatedOpenLinesByOrderText(
        lines: <ConsolidatedLineItem>[
          _srcLine(ref: '106916', req: 8, source: 'product'),
          _srcLine(ref: '106916', req: 7, source: 'action'),
        ],
        countTaLabel: 'шт',
        promoLabel: 'Акция',
      );
      expect(out, '106916: 15 шт (7 — Акция)');
    });

    test('aksiya belgisi label bo‘lmasa yoki hammasi aksiya bo‘lsa chiqmaydi', () {
      final List<ConsolidatedLineItem> mixed = <ConsolidatedLineItem>[
        _srcLine(ref: 'A', req: 8, source: 'product'),
        _srcLine(ref: 'A', req: 7, source: 'action'),
      ];
      expect(
        consolidatedOpenLinesByOrderText(lines: mixed, countTaLabel: 'шт'),
        'A: 15 шт',
      );
      expect(
        consolidatedOpenLinesByOrderText(
          lines: <ConsolidatedLineItem>[_srcLine(ref: 'B', req: 5, source: 'gift')],
          countTaLabel: 'шт',
          promoLabel: 'Акция',
        ),
        'B: 5 шт',
      );
    });

    test('turli buyurtmalar tartibi saqlanadi, terilganlar tushib qoladi', () {
      final String out = consolidatedOpenLinesByOrderText(
        lines: <ConsolidatedLineItem>[
          _srcLine(ref: '2', req: 3),
          _srcLine(ref: '1', req: 4, picked: 4),
          _srcLine(ref: '3', req: 2, picked: 1),
        ],
        countTaLabel: 'ta',
      );
      expect(out, '2: 3 ta, 3: 1 ta');
    });

    test('eski server (line_source yo‘q) — oddiy deb qaraladi', () {
      final ConsolidatedLineItem l = ConsolidatedLineItem.fromJson(<String, Object?>{
        'document_id': 'd',
        'line_id': 'l',
        'reference_number': 'R',
        'qty_required': 3,
        'qty_picked': 0,
        'location_code': 'P-01',
      });
      expect(l.isPromoLine, isFalse);
      expect(l.lineSource, isNull);
    });
  });

  group('consolidatedLocationQtyLine oddiy buyurtma formatida', () {
    test('bitta joy: kod · terildi/kerak (yig‘indi)', () {
      final String out = consolidatedLocationQtyLine(<ConsolidatedLineItem>[
        _srcLine(ref: 'A', req: 8, loc: 'P-Y-05'),
        _srcLine(ref: 'A', req: 7, loc: 'P-Y-05'),
      ]);
      expect(out, 'P-Y-05 · 0/15');
    });

    test('bir necha joy: har biri alohida', () {
      final String out = consolidatedLocationQtyLine(<ConsolidatedLineItem>[
        _srcLine(ref: 'A', req: 8, loc: 'P-Y-05'),
        _srcLine(ref: 'B', req: 7, picked: 2, loc: 'P-Y-07'),
      ]);
      expect(out, 'P-Y-05: 0/8 · P-Y-07: 2/7');
    });

    test('hammasi terilgan bo‘lsa ham joy ko‘rinadi', () {
      final String out = consolidatedLocationQtyLine(<ConsolidatedLineItem>[
        _srcLine(ref: 'A', req: 8, picked: 8, loc: 'P-Y-05'),
      ]);
      expect(out, 'P-Y-05 · 8/8');
    });

    test('bo‘sh ro‘yxat yoki joy kodi yo‘q — tire', () {
      expect(consolidatedLocationQtyLine(const <ConsolidatedLineItem>[]), '—');
      expect(
        consolidatedLocationQtyLine(<ConsolidatedLineItem>[_srcLine(ref: 'A', req: 1, loc: '')]),
        '—',
      );
    });
  });
}
