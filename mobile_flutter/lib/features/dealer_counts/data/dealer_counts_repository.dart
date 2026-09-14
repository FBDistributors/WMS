import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';
import 'dealer_counts_models.dart';

/// Ro'yxat serverda yo'q (admin web'dan o'chirgan) — telefondagi nusxa endi keraksiz.
class DealerSheetGoneException implements Exception {
  const DealerSheetGoneException(this.message);

  /// Server matni ("Sanov topilmadi") — oddiy xato sifatida ko'rsatilsa ham tushunarli.
  final String message;

  @override
  String toString() => message;
}

/// 404 — alohida (nusxani tozalash uchun), qolgani oddiy xabar.
Never _rethrow(DioException e) {
  if (e.response?.statusCode == 404) {
    throw DealerSheetGoneException(mapDioExceptionToMessage(e));
  }
  throw Exception(mapDioExceptionToMessage(e));
}

class DealerCountsRepository {
  DealerCountsRepository(this._dio);

  static const String _path = '/dealer-counts';
  final Dio _dio;

  /// Men sanab yuborgan sanovlar (Tarix).
  Future<List<DealerCount>> listMine({int limit = 50}) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        _path,
        queryParameters: <String, Object?>{'mine': true, 'status': 'submitted', 'limit': limit},
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
      _rethrow(e);
    }
  }

  // --- tayyor ro'yxat (ведомость): web'da tuziladi, telefon oladi va sanaydi ---

  /// Menga ochiq ro'yxatlar: hali olinmagan (draft) + men olgan (in_progress).
  /// Boshqa xodim olgani qaytmaydi — uni baribir ochib bo'lmaydi.
  Future<List<DealerCount>> listSheets({int limit = 50}) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        _path,
        queryParameters: <String, Object?>{'status': 'draft,in_progress', 'available': true, 'limit': limit},
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
      _rethrow(e);
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
      _rethrow(e);
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
      _rethrow(e);
    }
  }
}
