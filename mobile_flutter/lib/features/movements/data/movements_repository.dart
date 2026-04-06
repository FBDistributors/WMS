import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';

class TransferLocationResponse {
  const TransferLocationResponse({
    required this.linesTransferred,
    required this.movementsCreated,
  });

  final int linesTransferred;
  final int movementsCreated;

  factory TransferLocationResponse.fromJson(Map<String, Object?> json) {
    return TransferLocationResponse(
      linesTransferred: _int(json['lines_transferred']),
      movementsCreated: _int(json['movements_created']),
    );
  }
}

class MovementsRepository {
  MovementsRepository(this._dio);

  final Dio _dio;

  Future<String> createStockMovement({
    required String productId,
    required String lotId,
    required String locationId,
    required double qtyChange,
    String movementType = 'adjust',
    String? reasonCode,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/inventory/movements',
        data: <String, Object?>{
          'product_id': productId,
          'lot_id': lotId,
          'location_id': locationId,
          'qty_change': qtyChange,
          'movement_type': movementType,
          if (reasonCode != null) 'reason_code': reasonCode,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('movement');
      }
      final Object? id = data['id'];
      return id is String ? id : id?.toString() ?? '';
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<TransferLocationResponse> transferLocationStock({
    required String fromLocationId,
    required String toLocationId,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/inventory/movements/transfer-location',
        data: <String, String>{
          'from_location_id': fromLocationId,
          'to_location_id': toLocationId,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('transfer');
      }
      return TransferLocationResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}

int _int(Object? v) {
  if (v is int) {
    return v;
  }
  if (v is num) {
    return v.toInt();
  }
  if (v is String) {
    return int.tryParse(v) ?? 0;
  }
  return 0;
}
