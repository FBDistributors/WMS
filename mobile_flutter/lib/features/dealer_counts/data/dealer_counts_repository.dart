import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';
import 'dealer_counts_models.dart';

/// Sanov serverda yo'q (admin web'dan o'chirgan) — telefondagi nusxa endi keraksiz.
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

class CountsResult {
  const CountsResult({required this.stale, required this.count});

  /// Serverda shu qator keyinroq (boshqa xodim tomonidan) sanalgan — telefondagi eski qiymat yozilmadi.
  final int stale;
  final DealerCount count;
}

/// Diller sanovi API (onlayn): faol sanovlar ro'yxati, sanov, kiritishlarni yozish, o'zgarganlarni
/// olish. Telefon sanov yaratmaydi va tahrirlamaydi — bu web'da.
class DealerCountsRepository {
  DealerCountsRepository(this._dio);

  static const String _path = '/dealer-counts';
  final Dio _dio;

  /// Faol sanovlar (har dillerda bitta). 500 — hamma dillerni qamraydi.
  Future<List<DealerCount>> listActive({int limit = 500}) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        _path,
        queryParameters: <String, Object?>{'active': true, 'limit': limit},
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

  /// Kiritishlarni yozish (`op_id` bo'yicha idempotent). Javobda faqat shu kiritishlar tekkan
  /// qatorlar + jami ko'rsatkichlar (`lines=changed`) — 3808 qatorli sanov har safar tortilmaydi.
  Future<CountsResult> putCounts(String id, List<Map<String, Object?>> entries) async {
    try {
      final Response<Object?> res = await _dio.put<Object?>(
        '$_path/$id/counts',
        queryParameters: <String, Object?>{'lines': 'changed'},
        data: <String, Object?>{'entries': entries},
      );
      final Object? data = res.data;
      if (data is! Map || data['count'] is! Map) {
        throw const FormatException('counts');
      }
      return CountsResult(
        stale: (data['stale'] as num?)?.toInt() ?? 0,
        count: DealerCount.fromJson(Map<String, Object?>.from(data['count'] as Map)),
      );
    } on DioException catch (e) {
      _rethrow(e);
    }
  }

  /// Ochiq sanovda `since` dan beri o'zgargan qatorlar (boshqa xodimlar sanagani).
  /// `since` null — hamma qator.
  Future<DealerChangedLines> changedLines(String id, {String? since}) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '$_path/$id/lines',
        queryParameters: <String, Object?>{if (since != null && since.isNotEmpty) 'changed_since': since},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('changed lines');
      }
      return DealerChangedLines.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      _rethrow(e);
    }
  }
}
