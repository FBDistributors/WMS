import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/core/app_state/app_locale.dart';
import 'package:mobile_flutter/core/errors/api_error_localization.dart';
import 'package:mobile_flutter/features/movements/data/movements_repository.dart';
import 'package:mobile_flutter/features/movements/domain/sector_transfer_status.dart';
import 'package:mobile_flutter/l10n/string_lookup.dart';

Map<String, Object?> _row({
  required String fromCode,
  String? toCode,
  String status = kSectorStatusOk,
  int lines = 1,
  int qty = 10,
  int boxes = 0,
  bool movable = true,
}) {
  return <String, Object?>{
    'from_code': fromCode,
    'to_code': toCode,
    'lines': lines,
    'total_qty': qty,
    'boxes': boxes,
    'status': status,
    'movable': movable,
  };
}

void main() {
  group('sectorPrefixFromInput', () {
    test('a bare prefix is kept', () {
      expect(sectorPrefixFromInput('P-H'), 'P-H');
    });

    test('a scanned pallet label collapses to its sector', () {
      // Ombor xodimi sektorni skanerlay olmaydi — palet yorlig'ini skanerlaydi.
      expect(sectorPrefixFromInput('P-H-03'), 'P-H');
      expect(sectorPrefixFromInput('P-AU-01'), 'P-AU');
    });

    test('rack codes collapse to the shelf sector', () {
      expect(sectorPrefixFromInput('S-45-02-03'), 'S-45');
    });

    test('input is upper-cased and trimmed', () {
      expect(sectorPrefixFromInput('  p-h-03 '), 'P-H');
    });

    test('incomplete input returns null', () {
      expect(sectorPrefixFromInput(''), isNull);
      expect(sectorPrefixFromInput('P'), isNull);
      expect(sectorPrefixFromInput('-'), isNull);
    });
  });

  group('SectorTransferPreview parsing', () {
    test('summary and rows are read', () {
      final SectorTransferPreview p = SectorTransferPreview.fromJson(<String, Object?>{
        'from_prefix': 'P-H',
        'to_prefix': 'P-K',
        'can_submit': true,
        'locations_total': 3,
        'locations_to_move': 2,
        'lines_to_move': 5,
        'boxes_to_move': 1,
        'total_qty_to_move': 120,
        'rows': <Object?>[
          _row(fromCode: 'P-H-01', toCode: 'P-K-01'),
          _row(fromCode: 'P-H-02', toCode: 'P-K-02', boxes: 1),
          _row(
            fromCode: 'P-H-03',
            toCode: 'P-K-03',
            status: kSectorStatusEmpty,
            lines: 0,
            qty: 0,
            movable: false,
          ),
        ],
      });

      expect(p.fromPrefix, 'P-H');
      expect(p.canSubmit, isTrue);
      expect(p.locationsToMove, 2);
      expect(p.totalQtyToMove, 120);
      expect(p.rows, hasLength(3));
      expect(p.blockingRows, isEmpty);
    });

    test('blocking rows are detected from status', () {
      final SectorTransferPreview p = SectorTransferPreview.fromJson(<String, Object?>{
        'from_prefix': 'P-H',
        'to_prefix': 'P-K',
        'can_submit': false,
        'rows': <Object?>[
          _row(fromCode: 'P-H-01', toCode: 'P-K-01'),
          _row(
            fromCode: 'P-H-02',
            status: kSectorStatusDestMissing,
            movable: false,
          ),
          _row(
            fromCode: 'P-H-03',
            toCode: 'P-K-03',
            status: kSectorStatusReserved,
            movable: false,
          ),
        ],
      });

      expect(p.canSubmit, isFalse);
      expect(
        p.blockingRows.map((SectorTransferRow r) => r.fromCode),
        <String>['P-H-02', 'P-H-03'],
      );
      // Manzil yo'q qatorda to_code bo'sh bo'ladi — UI '—' ko'rsatadi.
      expect(p.blockingRows.first.toCode, isNull);
    });

    test('a warning row still moves', () {
      final SectorTransferRow r = SectorTransferRow.fromJson(
        _row(fromCode: 'P-H-01', toCode: 'P-K-01', status: kSectorStatusDestNotEmpty),
      );

      expect(r.blocking, isFalse);
      expect(r.movable, isTrue);
    });

    test('missing rows key yields an empty plan instead of throwing', () {
      final SectorTransferPreview p = SectorTransferPreview.fromJson(<String, Object?>{
        'from_prefix': 'P-H',
        'to_prefix': 'P-K',
        'can_submit': false,
      });

      expect(p.rows, isEmpty);
      expect(p.blockingRows, isEmpty);
    });
  });

  group('sectorStatusLabelKey', () {
    test('every status has a label in all three languages', () {
      const List<String> statuses = <String>[
        kSectorStatusOk,
        kSectorStatusEmpty,
        kSectorStatusDestMissing,
        kSectorStatusReserved,
        kSectorStatusExpiryConflict,
        kSectorStatusDestNotEmpty,
      ];
      for (final String status in statuses) {
        final String key = sectorStatusLabelKey(status);
        for (final AppLocale loc in AppLocale.values) {
          final String label = StringLookup.t(loc, key);
          expect(label, isNotEmpty);
          // Kalitning o'zi qaytsa — tarjima yo'q degani.
          expect(label, isNot(key), reason: '$key ($loc) tarjimasi yo\'q');
        }
      }
    });

    test('an unknown status falls back to the ok label', () {
      expect(sectorStatusLabelKey('kosmos'), 'sectorStatusOk');
    });
  });

  group('sector errors are localized', () {
    void expectMapped(String backend, String key) {
      for (final AppLocale loc in AppLocale.values) {
        expect(
          localizeApiErrorMessage(loc, Exception(backend)),
          StringLookup.t(loc, key),
          reason: '$backend -> $key ($loc)',
        );
      }
    }

    test('sector not found', () {
      expectMapped('Sektor topilmadi: P-ZZ', 'sectorNotFound');
    });

    test('ambiguous sector', () {
      expectMapped(
        'Sektor S-88 bir nechta joy turiga mos keladi (RACK, SHOWROOM_RACK)',
        'sectorAmbiguous',
      );
    });

    test('mismatched sector types', () {
      expectMapped(
        'Sektor turlari mos emas: P-TA — FLOOR, S-TB — RACK',
        'sectorTypesMismatch',
      );
    });

    test('blocked transfer', () {
      expectMapped(
        "Sektorni ko'chirib bo'lmadi: to'siq bor joylar mavjud yoki ko'chadigan qoldiq yo'q",
        'sectorTransferBlocked',
      );
    });

    test('russian output does not leak uzbek backend text', () {
      final String ru = localizeApiErrorMessage(
        AppLocale.ru,
        Exception('Sektor topilmadi: P-ZZ'),
      );
      expect(ru, isNot(contains('Sektor topilmadi')));
    });
  });
}
