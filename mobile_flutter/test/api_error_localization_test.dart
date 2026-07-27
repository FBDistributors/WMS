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

  test('localizeApiErrorMessage strips Exception prefix and keeps unknown reason visible', () {
    final String msg = localizeApiErrorMessage(
      AppLocale.uz,
      Exception('Some other error'),
    );
    expect(
      msg,
      StringLookup.tParams(
        AppLocale.uz,
        'operationFailedWithReason',
        <String, String>{'reason': 'Some other error'},
      ),
    );
    expect(msg, contains('Some other error'));
  });

  test('localizeApiErrorMessage unknown reason visible in English', () {
    final String en = localizeApiErrorMessage(
      AppLocale.en,
      Exception('Network timeout'),
    );
    expect(
      en,
      StringLookup.tParams(
        AppLocale.en,
        'operationFailedWithReason',
        <String, String>{'reason': 'Network timeout'},
      ),
    );
  });

  group('transfer-location errors translate to user locale', () {
    test('no transfer lines selected', () {
      expect(
        localizeApiErrorMessage(AppLocale.uz, Exception('No transfer lines selected')),
        StringLookup.t(AppLocale.uz, 'movementNothingToTransfer'),
      );
      expect(
        localizeApiErrorMessage(AppLocale.ru, Exception('No transfer lines selected')),
        StringLookup.t(AppLocale.ru, 'movementNothingToTransfer'),
      );
    });

    test('no available quantity at source', () {
      expect(
        localizeApiErrorMessage(
          AppLocale.uz,
          Exception('No available quantity to transfer at the source location'),
        ),
        StringLookup.t(AppLocale.uz, 'movementNoAvailableAtSource'),
      );
    });

    test('insufficient available with params', () {
      final String uz = localizeApiErrorMessage(
        AppLocale.uz,
        Exception("Yetarli qoldiq yo'q (lot\\joy: mavjud 12, so'ralgan 20)"),
      );
      expect(uz, contains('12'));
      expect(uz, contains('20'));
      expect(uz, StringLookup.tParams(
        AppLocale.uz,
        'stockInsufficientAvailable',
        <String, String>{'available': '12', 'requested': '20'},
      ));
    });

    test('boxed stock loose-only with params', () {
      final String ru = localizeApiErrorMessage(
        AppLocale.ru,
        Exception(
          "Qutidagi zaxirani dona qilib ko'chirib bo'lmaydi "
          "(qutisiz mavjud 18). Avval qutini ko'chiring yoki oching.",
        ),
      );
      expect(ru, contains('18'));
      expect(ru, StringLookup.tParams(
        AppLocale.ru,
        'movementBoxedStockLooseOnly',
        <String, String>{'loose': '18'},
      ));
    });

    test('box invariant violated with params', () {
      final String uz = localizeApiErrorMessage(
        AppLocale.uz,
        Exception(
          'Quti invariant buzildi: qutilardagi dona (24) '
          'fizik qoldiqdan (12) oshib ketdi',
        ),
      );
      expect(uz, StringLookup.tParams(
        AppLocale.uz,
        'boxInvariantViolated',
        <String, String>{'inBoxes': '24', 'onHand': '12'},
      ));
    });

    test('negative balance detected', () {
      expect(
        localizeApiErrorMessage(
          AppLocale.en,
          Exception('Negative balance detected after operation'),
        ),
        StringLookup.t(AppLocale.en, 'negativeBalanceDetected'),
      );
    });

    test('idempotency conflict and duplicate in progress', () {
      expect(
        localizeApiErrorMessage(
          AppLocale.uz,
          Exception('Idempotency-Key already used with different payload'),
        ),
        StringLookup.t(AppLocale.uz, 'idempotencyConflict'),
      );
      expect(
        localizeApiErrorMessage(
          AppLocale.uz,
          Exception('Duplicate request in progress. Try again.'),
        ),
        StringLookup.t(AppLocale.uz, 'duplicateRequestInProgress'),
      );
    });

    test('source/destination inactive and same-location', () {
      expect(
        localizeApiErrorMessage(
          AppLocale.uz,
          Exception('Source location not found or inactive'),
        ),
        StringLookup.t(AppLocale.uz, 'movementSourceInactive'),
      );
      expect(
        localizeApiErrorMessage(
          AppLocale.uz,
          Exception('Destination location not found or inactive'),
        ),
        StringLookup.t(AppLocale.uz, 'movementDestInactive'),
      );
      expect(
        localizeApiErrorMessage(
          AppLocale.uz,
          Exception('Source and destination locations must differ'),
        ),
        StringLookup.t(AppLocale.uz, 'movementSourceDestinationSame'),
      );
    });
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

  group('picking scan-flow errors translate to user locale', () {
    void expectMapped(String backend, String key) {
      for (final AppLocale loc in AppLocale.values) {
        final String got = localizeApiErrorMessage(loc, Exception(backend));
        expect(got, StringLookup.t(loc, key), reason: '$backend -> $key ($loc)');
      }
    }

    test('qty exceeds required (english backend)', () {
      expectMapped('qty_picked cannot exceed qty_required', 'pickQtyExceedsRequired');
    });

    test('qty exceeds required (uzbek backend)', () {
      expectMapped(
        "Terish miqdori buyurtma bo'yicha kerak miqdordan oshib ketdi. Ehtimol allaqachon terilgan.",
        'pickQtyExceedsRequired',
      );
    });

    test('qty below zero', () {
      expectMapped('qty_picked cannot be below 0', 'pickQtyBelowZero');
    });

    test('delta cannot exceed picked', () {
      expectMapped('delta cannot exceed qty_picked', 'pickDeltaExceedsPicked');
    });

    test('line already fully picked', () {
      expectMapped('Line already fully picked', 'pickLineAlreadyFull');
    });

    test('invalid lot', () {
      expectMapped('Invalid lot for this product', 'pickInvalidLot');
    });

    test('only normal zone', () {
      expectMapped(
        'Pick only from NORMAL zone. Line location is not NORMAL.',
        'pickOnlyNormalZone',
      );
    });

    test('document must be in picked status', () {
      expectMapped('Document must be in picked status', 'pickDocMustBePicked');
    });

    test('qty exceed does not leak english into russian', () {
      final String ru = localizeApiErrorMessage(
        AppLocale.ru,
        Exception('qty_picked cannot exceed qty_required'),
      );
      expect(ru, isNot(contains('qty_picked')));
      expect(ru, isNot(contains('exceed')));
    });

    test('plain barcode required is not shadowed by hybrid variant', () {
      expectMapped('barcode required', 'pickBarcodeRequired');
      expectMapped('barcode required for hybrid pick', 'pickBarcodeRequiredHybrid');
    });
  });

  group('no backend message leaks untranslated into another language', () {
    // Backenddagi haqiqiy foydalanuvchi xabarlari. Ro'yxatga yangi xabar
    // qo'shilsa va tarjimasi bo'lmasa — test yiqiladi, chunki fallback xom
    // matnni javobga qo'shib yuboradi.
    const List<String> backendMessages = <String>[
      // Quti / inventarizatsiya
      "Qoldiqni quti ichidagi donadan past tushirib bo'lmaydi (qutida 80 dona). "
          "Avval qutini oching (unpack) yoki quti sanog'ini (count) ishlating.",
      'Sealed quti yetarli emas (kerak 3, mavjud 1)',
      'Quti bu lokatsiyada joylashmagan',
      'Quti joylashmagan',
      "Quti ichidagi dona soni noto'g'ri",
      'Quti topilmadi',
      'Quti mahsulotga mos emas',
      "Quti topilmadi yoki noto'g'ri",
      "Bu kod mahsulot (dona) shtrix-kodi sifatida band — quti kodi qilib bo'lmaydi",
      "box_count manfiy bo'lmasligi kerak",
      "loose_units manfiy bo'lmasligi kerak",
      "Quti terish: ajratishlarda yetarli joy yo'q",
      "Quti terish: buyurtma qatorlarida yetarli joy yo'q",
      "Qutilardagi dona jami qoldiqdan oshib ketgan (ma'lumot nomuvofiqligi)",
      // Terish / sessiya
      'Barcha qatorlar uchun mahsulot skanerlanishi kerak',
      'Bu sessiya sizga tegishli emas',
      "Terilgan miqdor sessiya bilan mos kelmaydi — yig'uvchi to'xtatilgan bo'lishi kerak",
      'Tovar (shtrix-kod/SKU) mos emas. Kutilgan qator uchun skanerlang.',
      "Terish miqdori buyurtma bo'yicha kerak miqdordan oshib ketdi. Ehtimol allaqachon terilgan.",
      "Mahsulot topilmadi yoki sizning vazifangizda yo'q",
      'Faqat controller uchun',
      "VIP muddat: bu qator faqat ma'lumot uchun",
      "Tanlangan joyda qolgan terish uchun yetarli qoldiq yo‘q",
      // Bekor qilish / qaytim
      'Buyurtma bekor qilinmoqda: avval terilganlarni joyiga qaytaring.',
      'Buyurtma xavfsiz bekor rejimida: avval qaytarish tugallansin',
      'Xavfsiz bekor faqat `picking` yoki `completed` holatida mumkin',
      'Hujjat holati bekor qilishga mos emas',
      "Terilgan qator yo'q — oddiy bekor ishlating",
      "Qator 42 uchun product/lot/joy to'liq emas — xavfsiz bekor mumkin emas",
      "Ortiqcha pick topilmadi yoki allaqachon to'g'ri.",
      'Qaytarish topilmadi',
      "Qaytimda mahsulot yo'q",
      "Buyurtma jo'natilgan (ship) — qaytim mumkin emas",
      'Ba\'zi mahsulotlar WMS bazasida topilmadi',
      // Ko'chirish / sektor
      "Qutidagi zaxirani dona qilib ko'chirib bo'lmaydi (qutisiz mavjud 4). "
          "Avval qutini ko'chiring yoki oching.",
      'Joyda rezervdagi (terish uchun band) zaxira bor: 5 dona',
      'Sektor topilmadi: P-ZZ',
      'Sektor S-88 bir nechta joy turiga mos keladi (RACK, SHOWROOM_RACK)',
      "Sektorni ko'chirib bo'lmadi: to'siq bor joylar mavjud yoki ko'chadigan qoldiq yo'q",
      // Qabul
      'Qabul qilingan qoldiq yetarli emas (kerak 10, mavjud 4)',
      "Qutisiz qoldiq yetarli emas (kerak 3, mavjud 0). Quti skan qiling.",
      'Bitta lokatsiyaga ikki xil muddati bor mahsulotni kirg\'azish taqiqlanadi.',
    ];

    test('russian output never contains the raw backend text', () {
      for (final String backend in backendMessages) {
        final String ru = localizeApiErrorMessage(AppLocale.ru, Exception(backend));
        expect(
          ru,
          isNot(contains(backend)),
          reason: 'Tarjima yo\'q, xom matn sizib chiqdi: $backend',
        );
      }
    });

    test('english output never contains the raw backend text', () {
      for (final String backend in backendMessages) {
        final String en = localizeApiErrorMessage(AppLocale.en, Exception(backend));
        expect(
          en,
          isNot(contains(backend)),
          reason: 'Tarjima yo\'q, xom matn sizib chiqdi: $backend',
        );
      }
    });

    test('the leak detector itself works on an unmapped message', () {
      const String unmapped = 'Bunday xabar xaritalanmagan albatta';
      expect(
        localizeApiErrorMessage(AppLocale.ru, Exception(unmapped)),
        contains(unmapped),
      );
    });
  });
}
