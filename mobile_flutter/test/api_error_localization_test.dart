import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/core/app_state/app_locale.dart';
import 'package:mobile_flutter/core/errors/api_error_localization.dart';

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

  test('localizeApiErrorMessage strips Exception prefix', () {
    final String msg = localizeApiErrorMessage(
      AppLocale.uz,
      Exception('Some other error'),
    );
    expect(msg, 'Some other error');
  });
}
