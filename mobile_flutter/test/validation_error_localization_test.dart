import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/core/app_state/app_locale.dart';
import 'package:mobile_flutter/core/errors/api_error_localization.dart';
import 'package:mobile_flutter/core/network/app_dio.dart';

/// FastAPI 422 javobi — ekranga xom `{type: ..., loc: [...]}` bo'lib chiqmasin.
DioException _validationError(List<Map<String, Object?>> detail) {
  final RequestOptions options = RequestOptions(path: '/receipts');
  return DioException(
    requestOptions: options,
    response: Response<Object?>(
      requestOptions: options,
      statusCode: 422,
      data: <String, Object?>{'detail': detail},
    ),
  );
}

void main() {
  test('box_count chegarasi ruscha tushunarli jumlaga aylanadi', () {
    final String raw = mapDioExceptionToMessage(
      _validationError(<Map<String, Object?>>[
        <String, Object?>{
          'type': 'less_than_equal',
          'loc': <Object?>['body', 'lines', 0, 'box_count'],
          'msg': 'Input should be less than or equal to 500',
          'input': 510,
          'ctx': <String, Object?>{'le': 500},
        },
      ]),
    );

    final String ru = localizeApiErrorMessage(AppLocale.ru, Exception(raw));
    expect(ru, contains('Количество коробок'));
    expect(ru, contains('500'));
    // Inglizcha xom matn va lug'at ko'rinishi qolmasligi kerak.
    expect(ru, isNot(contains('Input should be')));
    expect(ru, isNot(contains('less_than_equal')));
    expect(ru, isNot(contains('loc')));
  });

  test('o’zbekcha va inglizcha ham tarjima qilinadi', () {
    final String raw = mapDioExceptionToMessage(
      _validationError(<Map<String, Object?>>[
        <String, Object?>{
          'type': 'greater_than_equal',
          'loc': <Object?>['body', 'lines', 0, 'box_count'],
          'msg': 'Input should be greater than or equal to 1',
          'ctx': <String, Object?>{'ge': 1},
        },
      ]),
    );

    expect(localizeApiErrorMessage(AppLocale.uz, Exception(raw)),
        contains('Quti soni'));
    expect(localizeApiErrorMessage(AppLocale.en, Exception(raw)),
        contains('Box count'));
  });

  test('bir nechta xato alohida qatorlarda beriladi', () {
    final String raw = mapDioExceptionToMessage(
      _validationError(<Map<String, Object?>>[
        <String, Object?>{
          'type': 'less_than_equal',
          'loc': <Object?>['body', 'lines', 0, 'box_count'],
          'ctx': <String, Object?>{'le': 500},
        },
        <String, Object?>{
          'type': 'missing',
          'loc': <Object?>['body', 'lines', 0, 'location_id'],
        },
      ]),
    );

    final String uz = localizeApiErrorMessage(AppLocale.uz, Exception(raw));
    expect(uz.split('\n').length, 2);
    expect(uz, contains('Quti soni'));
  });

  test('matnli detail o’zgarishsiz qoladi', () {
    final RequestOptions options = RequestOptions(path: '/receipts');
    final String raw = mapDioExceptionToMessage(
      DioException(
        requestOptions: options,
        response: Response<Object?>(
          requestOptions: options,
          statusCode: 409,
          data: <String, Object?>{'detail': 'Negative balance detected'},
        ),
      ),
    );
    expect(raw, 'Negative balance detected');
  });
}
