import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/core/app_state/app_locale.dart';
import 'package:mobile_flutter/core/errors/api_error_localization.dart';
import 'package:mobile_flutter/l10n/string_lookup.dart';

void main() {
  test('localizeApiErrorMessage maps inconsistent breakdown to Russian', () {
    const String uzBackend =
        "Qutilardagi dona jami qoldiqdan oshib ketgan (ma'lumot nomuvofiqligi)";
    final String ru = localizeApiErrorMessage(
      AppLocale.ru,
      Exception(uzBackend),
    );
    expect(ru, contains('Несоответствие данных'));
    expect(ru, isNot(contains('nomuvofiqligi')));
  });

  test('localizeApiErrorMessage maps insufficient loose with params', () {
    final String ru = localizeApiErrorMessage(
      AppLocale.ru,
      Exception('Qutisiz qoldiq yetarli emas (kerak 3, mavjud 0). Quti skan qiling.'),
    );
    expect(ru, contains('3'));
    expect(ru, contains('0'));
    expect(ru, contains('коробку'));
  });

  test('localizeApiErrorMessage strips Exception prefix and falls back for unknown', () {
    final String msg = localizeApiErrorMessage(
      AppLocale.uz,
      Exception('Some other error'),
    );
    expect(msg, StringLookup.t(AppLocale.uz, 'operationFailed'));
  });

  test('localizeApiErrorMessage operationFailed in English', () {
    final String en = localizeApiErrorMessage(
      AppLocale.en,
      Exception('Network timeout'),
    );
    expect(en, StringLookup.t(AppLocale.en, 'operationFailed'));
  });

  test('localizeApiErrorMessage maps box_count required for box scan', () {
    final String ru = localizeApiErrorMessage(
      AppLocale.ru,
      Exception('box_count required for box scan'),
    );
    expect(ru, contains('коробок'));
  });

  test('localizeApiErrorMessage maps hybrid barcode required', () {
    final String ru = localizeApiErrorMessage(
      AppLocale.ru,
      Exception('barcode required for hybrid pick'),
    );
    expect(ru, contains('гибридного'));
  });

  group('receiving errors translate to user locale', () {
    const String singleExpiryUz =
        "Bitta lokatsiyaga ikki xil muddati bor mahsulotni kirg'azish taqiqlanadi. "
        'Ushbu lokatsiyada bu mahsulot boshqa muddat bilan mavjud.';

    test('location single expiry — uz, ru, en', () {
      expect(
        localizeApiErrorMessage(AppLocale.uz, Exception(singleExpiryUz)),
        StringLookup.t(AppLocale.uz, 'receivingLocationSingleExpiry'),
      );
      final String ru = localizeApiErrorMessage(AppLocale.ru, Exception(singleExpiryUz));
      expect(ru, StringLookup.t(AppLocale.ru, 'receivingLocationSingleExpiry'));
      expect(ru, contains('сроками'));
      final String en = localizeApiErrorMessage(AppLocale.en, Exception(singleExpiryUz));
      expect(en, StringLookup.t(AppLocale.en, 'receivingLocationSingleExpiry'));
      expect(en, contains('expiry'));
    });

    test('box not found reuses inventoryBoxNotFound', () {
      expect(
        localizeApiErrorMessage(AppLocale.ru, Exception('Quti topilmadi')),
        StringLookup.t(AppLocale.ru, 'inventoryBoxNotFound'),
      );
      expect(
        localizeApiErrorMessage(AppLocale.en, Exception('Quti topilmadi')),
        StringLookup.t(AppLocale.en, 'inventoryBoxNotFound'),
      );
    });

    test('box product mismatch reuses inventoryBoxProductMismatch', () {
      expect(
        localizeApiErrorMessage(AppLocale.en, Exception('Quti mahsulotga mos emas')),
        StringLookup.t(AppLocale.en, 'inventoryBoxProductMismatch'),
      );
    });

    test('box barcode and count required', () {
      const String backend = 'box_barcode va box_count birgalikda berilishi kerak';
      expect(
        localizeApiErrorMessage(AppLocale.ru, Exception(backend)),
        StringLookup.t(AppLocale.ru, 'receivingBoxBarcodeCountRequired'),
      );
    });

    test('qty below box units with params', () {
      final String ru = localizeApiErrorMessage(
        AppLocale.ru,
        Exception('qty 5 < box_count * units_per_box (6)'),
      );
      expect(ru, contains('5'));
      expect(ru, contains('6'));
      expect(ru, StringLookup.tParams(
        AppLocale.ru,
        'receivingQtyBelowBoxUnits',
        <String, String>{'qty': '5', 'expected': '6'},
      ));
    });

    test('insufficient received stock with params', () {
      final String en = localizeApiErrorMessage(
        AppLocale.en,
        Exception('Qabul qilingan qoldiq yetarli emas (kerak 6, mavjud 0)'),
      );
      expect(en, contains('6'));
      expect(en, contains('0'));
      expect(en, StringLookup.tParams(
        AppLocale.en,
        'receivingInsufficientStock',
        <String, String>{'needed': '6', 'available': '0'},
      ));
    });

    test('box placement not configured', () {
      const String backend =
          'Quti joylashuvi sozlanmagan (location_box_placements). '
          'Serverda alembic upgrade head ishga tushiring.';
      expect(
        localizeApiErrorMessage(AppLocale.en, Exception(backend)),
        StringLookup.t(AppLocale.en, 'receivingBoxPlacementNotConfigured'),
      );
    });

    test('expiry in past', () {
      expect(
        localizeApiErrorMessage(
          AppLocale.ru,
          Exception('Expiry date 2020-01-01 is in the past for product abc'),
        ),
        StringLookup.t(AppLocale.ru, 'receivingExpiryInPast'),
      );
    });

    test('product and location not found', () {
      expect(
        localizeApiErrorMessage(AppLocale.uz, Exception('Product not found')),
        StringLookup.t(AppLocale.uz, 'receivingProductNotFound'),
      );
      expect(
        localizeApiErrorMessage(AppLocale.en, Exception('Location not found')),
        StringLookup.t(AppLocale.en, 'receivingLocationNotFound'),
      );
    });

    test('lot product mismatch', () {
      expect(
        localizeApiErrorMessage(AppLocale.ru, Exception('Partiya mahsulotga mos emas')),
        StringLookup.t(AppLocale.ru, 'receivingLotProductMismatch'),
      );
    });
  });
}
