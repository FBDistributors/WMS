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
}
