import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';

import '../../../core/network/app_dio.dart';
import '../domain/pick_scan_resolution.dart';
import 'picking_models.dart';

/// Navbatdagi hujjatni boshqa controller allaqachon band qilgan (backend 409).
class PickingClaimConflict implements Exception {
  const PickingClaimConflict(this.message);

  final String message;

  @override
  String toString() => message;
}

class PickingRepository {
  PickingRepository(this._dio);

  static const String _p = '/picking';
  final Dio _dio;

  Future<MyPickerStats> getMyPickerStats({int days = 7}) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '$_p/my-stats',
        queryParameters: <String, int>{'days': days},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('stats');
      }
      return MyPickerStats.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<List<PickerUser>> getPickers() async {
    try {
      final Response<Object?> res = await _dio.get<Object?>('$_p/pickers');
      return _listMap(res.data)
          .map((Map<String, Object?> m) => PickerUser.fromJson(m))
          .toList(growable: false);
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<List<PickingListItem>> getOpenTasks({int limit = 50, int offset = 0}) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '$_p/documents',
        queryParameters: <String, Object?>{
          'limit': limit,
          'offset': offset,
          'include_cancelled': false,
        },
      );
      return _listMap(res.data)
          .map((Map<String, Object?> m) => PickingListItem.fromJson(m))
          .toList(growable: false);
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<PickingDocument> getTaskById(String documentId) async {
    try {
      final Response<Object?> res =
          await _dio.get<Object?>('$_p/documents/$documentId');
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('document');
      }
      return PickingDocument.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  /// Hujjatni umumiy tekshiruv navbatiga yuboradi (controller tanlanmaydi).
  Future<PickingDocument> sendToController(String documentId) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_p/documents/$documentId/send-to-controller',
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('document');
      }
      return PickingDocument.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  /// Controller navbatdagi hujjatni o'ziga band qiladi.
  ///
  /// Boshqa controller ulgurgan bo'lsa [PickingClaimConflict] tashlanadi.
  Future<PickingDocument> claimDocument(String documentId) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_p/documents/$documentId/claim',
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('document');
      }
      return PickingDocument.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      if (e.response?.statusCode == 409) {
        throw PickingClaimConflict(mapDioExceptionToMessage(e));
      }
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  /// Band qilingan hujjatni umumiy navbatga qaytaradi (skan boshlanmagan bo'lsa).
  Future<PickingDocument> releaseDocument(String documentId) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_p/documents/$documentId/release',
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('document');
      }
      return PickingDocument.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<void> markControllerVerificationStarted(String documentId) async {
    try {
      await _dio.post<Object?>(
        '$_p/documents/$documentId/controller-verification-started',
      );
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<PickLineResponse> changePickSource(
    String lineId, {
    required String locationId,
    required String lotId,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_p/lines/$lineId/change-pick-source',
        data: <String, String>{
          'location_id': locationId,
          'lot_id': lotId,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('pick line');
      }
      return PickLineResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<PickingDocument> completePickDocument(
    String documentId, {
    String? incompleteReason,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_p/documents/$documentId/complete',
        data: <String, String?>{
          if (incompleteReason != null) 'incomplete_reason': incompleteReason,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('document');
      }
      return PickingDocument.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<ConsolidatedViewResponse> getConsolidatedView() async {
    try {
      final Response<Object?> res = await _dio.get<Object?>('$_p/consolidated');
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('consolidated');
      }
      return ConsolidatedViewResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<ConsolidatedViewResponse> consolidatedPick({
    required String barcode,
    required int qty,
    String? requestId,
    int? boxCount,
    String? boxBarcode,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_p/consolidated/pick',
        data: <String, Object?>{
          'barcode': barcode.trim(),
          'qty': qty,
          'request_id': requestId ?? const Uuid().v4(),
          if (boxCount != null) 'box_count': boxCount,
          if (boxBarcode != null && boxBarcode.trim().isNotEmpty)
            'box_barcode': boxBarcode.trim(),
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('consolidated');
      }
      return ConsolidatedViewResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<PickLineResponse> pickLine(
    String lineId,
    int delta,
    String requestId, {
    String? barcode,
    int? boxCount,
    String? boxBarcode,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_p/lines/$lineId/pick',
        data: <String, Object?>{
          'delta': delta,
          'request_id': requestId,
          if (barcode != null && barcode.trim().isNotEmpty) 'barcode': barcode.trim(),
          if (boxCount != null) 'box_count': boxCount,
          if (boxBarcode != null && boxBarcode.trim().isNotEmpty)
            'box_barcode': boxBarcode.trim(),
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('pick');
      }
      return PickLineResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<PickLineResponse> skipLine(String lineId, String reason) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_p/lines/$lineId/skip',
        data: <String, String>{'reason': reason.trim()},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('skip');
      }
      return PickLineResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  /// Controller tekshirishда qatorni sabab bilan belgilaydi (stock sababga qarab
  /// joyiga qaytadi yoki brak/muddat zonasiga ko'chadi).
  Future<PickLineResponse> controllerFlagLine(String lineId, String reason) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_p/lines/$lineId/controller-flag',
        data: <String, String>{'reason': reason.trim()},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('controller-flag');
      }
      return PickLineResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<PickLineResponse> unpickLine(
    String lineId, {
    required int delta,
    required String reason,
    required String requestId,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_p/lines/$lineId/unpick',
        data: <String, Object?>{
          'delta': delta,
          'reason': reason.trim(),
          'request_id': requestId,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('unpick');
      }
      return PickLineResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  bool _barcodeMatchesLineStrict(String raw, PickingLine line) {
    final String q = raw.trim().toLowerCase();
    if (q.isEmpty) {
      return false;
    }
    if (line.barcode != null && line.barcode!.toLowerCase() == q) {
      return true;
    }
    if (line.sku != null && line.sku!.toLowerCase() == q) {
      return true;
    }
    return false;
  }

  Future<PickLineResponse> submitScan(
    String taskId, {
    required String barcode,
    int qty = 1,
    String? lineId,
  }) async {
    final PickingDocument doc = await getTaskById(taskId);
    final String q = barcode.trim().toLowerCase();
    PickingLine? line;

    if (lineId != null && lineId.isNotEmpty) {
      for (final PickingLine l in doc.lines) {
        if (l.id == lineId) {
          line = l;
          break;
        }
      }
      if (line == null) {
        throw Exception('Qator topilmadi');
      }
      if (!_barcodeMatchesLineStrict(barcode, line)) {
        throw Exception(
          '"$barcode" ushbu pozitsiya uchun mos emas (${line.barcode ?? line.sku ?? "—"})',
        );
      }
    } else {
      line = resolveSubmitScanLine(doc.lines, barcode);
      if (line == null) {
        throw Exception('"$barcode" bo\'yicha pozitsiya topilmadi');
      }
    }
    final int count = qty < 1 ? 1 : qty;
    if (line.isVipExpiryInformational) {
      throw Exception(
        'VIP muddat: bu qator faqat ma\'lumot uchun, terilmaydi',
      );
    }
    if (line.qtyPicked + count > line.qtyRequired) {
      throw Exception(
        'Kerakli miqdor: ${line.qtyRequired}, terilgan: ${line.qtyPicked}',
      );
    }
    return pickLine(
      line.id,
      count,
      'scan-$taskId-${line.id}-${DateTime.now().millisecondsSinceEpoch}',
    );
  }

  Future<MyPeriodStats> getMyPeriodStats({int offset = 0}) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '$_p/my-period-stats',
        queryParameters: <String, Object?>{'offset': offset},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('my_period_stats');
      }
      return MyPeriodStats.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<SafeCancelReturnSession?> getMyReturnSession() async {
    try {
      final Response<Object?> res = await _dio.get<Object?>('$_p/return-session/mine');
      final Object? data = res.data;
      if (data == null) {
        return null;
      }
      if (data is! Map) {
        return null;
      }
      return SafeCancelReturnSession.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<SafeCancelReturnSession> getReturnSession(String sessionId) async {
    try {
      final Response<Object?> res =
          await _dio.get<Object?>('$_p/return-session/$sessionId');
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('return_session');
      }
      return SafeCancelReturnSession.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<SafeCancelReturnSession> scanReturnLocation(String sessionId, String raw) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_p/return-session/$sessionId/scan-location',
        data: <String, String>{'raw': raw.trim()},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('scan_location');
      }
      return SafeCancelReturnSession.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<SafeCancelReturnSession> scanReturnProduct(String sessionId, String raw) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_p/return-session/$sessionId/scan-product',
        data: <String, String>{'raw': raw.trim()},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('scan_product');
      }
      return SafeCancelReturnSession.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<SafeCancelReturnSession> finishReturnSession(String sessionId) async {
    try {
      final Response<Object?> res =
          await _dio.post<Object?>('$_p/return-session/$sessionId/finish');
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('finish_return');
      }
      return SafeCancelReturnSession.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<void> registerFcmToken({
    required String token,
    String? deviceId,
  }) async {
    try {
      await _dio.post<Object?>(
        '/picking/fcm-token',
        data: <String, Object?>{
          'token': token,
          if (deviceId != null) 'device_id': deviceId,
        },
      );
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}

List<Map<String, Object?>> _listMap(Object? data) {
  if (data is! List) {
    return const <Map<String, Object?>>[];
  }
  return data
      .whereType<Map<dynamic, dynamic>>()
      .map((Map<dynamic, dynamic> m) => Map<String, Object?>.from(m))
      .toList(growable: false);
}
