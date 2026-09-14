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

  // --- tayyor ro'yxat (ведомость) ---

  /// Serverdagi ochiq ro'yxatlar (draft + telefonda) — barcha sanovchilarga ko'rinadi.
  Future<List<DealerCount>> listSheets({int limit = 50}) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        _path,
        queryParameters: <String, Object?>{'status': 'draft,in_progress', 'limit': limit},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('dealer sheets');
      }
      final Object? items = data['items'];
      if (items is! List) {
        return const <DealerCount>[];
      }
      return items
          .whereType<Map>()
          .map((Map m) => DealerCount.fromJson(Map<String, Object?>.from(m)))
          .where((DealerCount c) => c.sheetLines > 0)
          .toList(growable: false);
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  /// Ro'yxatni olish: draft → in_progress (web qulflanadi). Qatorlar bilan qaytadi.
  Future<DealerCount> claim(String id) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>('$_path/$id/claim');
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('claim');
      }
      return DealerCount.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  /// Sanalgan qatorlarni yozish (idempotent — qayta yuborilsa o'sha qiymat).
  Future<DealerCount> putCounts(String id, List<Map<String, Object?>> entries) async {
    try {
      final Response<Object?> res = await _dio.put<Object?>(
        '$_path/$id/counts',
        data: <String, Object?>{'entries': entries},
      );
      final Object? data = res.data;
      if (data is! Map || data['count'] is! Map) {
        throw const FormatException('counts');
      }
      return DealerCount.fromJson(Map<String, Object?>.from(data['count'] as Map));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  /// Yuborish. `uncounted`: zero — sanalmaganlar 0 deb, keep — bo'sh qoladi.
  Future<DealerCount> submit(String id, {required String uncounted}) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_path/$id/submit',
        queryParameters: <String, Object?>{'uncounted': uncounted},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('submit');
      }
      return DealerCount.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}
