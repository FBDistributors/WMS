import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';
import 'general_customer_models.dart';

class GeneralCustomersRepository {
  GeneralCustomersRepository(this._dio);

  static const String _path = '/general-customers';
  final Dio _dio;

  Future<List<GeneralCustomerRow>> list({String? search, int limit = 50}) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        _path,
        queryParameters: <String, Object?>{
          if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
          'limit': limit,
        },
      );
      final Object? data = res.data;
      if (data is! List) {
        throw const FormatException('general customers');
      }
      return data
          .whereType<Map<dynamic, dynamic>>()
          .map(
            (Map<dynamic, dynamic> m) =>
                GeneralCustomerRow.fromJson(Map<String, Object?>.from(m)),
          )
          .toList(growable: false);
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}
