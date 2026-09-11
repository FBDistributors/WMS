import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';
import 'dealer_counts_models.dart';

class DealerCountsRepository {
  DealerCountsRepository(this._dio);

  static const String _path = '/dealer-counts';
  final Dio _dio;

  Future<List<Dealer>> listDealers({String? q}) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '$_path/dealers',
        queryParameters: <String, Object?>{if (q != null && q.trim().isNotEmpty) 'q': q.trim()},
      );
      final Object? data = res.data;
      if (data is! List) {
        throw const FormatException('dealers');
      }
      return data
          .whereType<Map>()
          .map((Map m) => Dealer.fromJson(Map<String, Object?>.from(m)))
          .toList(growable: false);
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  /// Draftni serverga yuborish. `client_uuid` bo'yicha idempotent — tarmoq
  /// uzilib qayta urinilsa ikkinchi hujjat paydo bo'lmaydi.
  Future<DealerCount> create(DealerCountDraft draft, {required bool submit}) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        _path,
        data: draft.toApiJson(submit: submit),
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('dealer count');
      }
      return DealerCount.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<List<DealerCount>> listMine({int limit = 50}) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        _path,
        queryParameters: <String, Object?>{'mine': true, 'limit': limit},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('dealer counts');
      }
      final Object? items = data['items'];
      if (items is! List) {
        return const <DealerCount>[];
      }
      return items
          .whereType<Map>()
          .map((Map m) => DealerCount.fromJson(Map<String, Object?>.from(m)))
          .toList(growable: false);
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<DealerCount> get(String id) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>('$_path/$id');
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('dealer count');
      }
      return DealerCount.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}
