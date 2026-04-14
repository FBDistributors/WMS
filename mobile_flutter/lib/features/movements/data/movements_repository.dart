import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';

/// HTTP 403 on POST /inventory/movements (inventory adjust permission).
class StockMovementForbiddenException implements Exception {
  const StockMovementForbiddenException();
}

class TransferLocationResponse {
  const TransferLocationResponse({
    required this.linesTransferred,
    required this.movementsCreated,
    required this.linesRequested,
  });

  final int linesTransferred;
  final int movementsCreated;
  final int linesRequested;

  factory TransferLocationResponse.fromJson(Map<String, Object?> json) {
    return TransferLocationResponse(
      linesTransferred: _int(json['lines_transferred']),
      movementsCreated: _int(json['movements_created']),
      linesRequested: _int(json['lines_requested']),
    );
  }
}

class TransferLocationLineInput {
  const TransferLocationLineInput({
    required this.productId,
    required this.lotId,
    required this.qty,
  });

  final String productId;
  final String lotId;
  final int qty;
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
      if (e.response?.statusCode == 403) {
        throw const StockMovementForbiddenException();
      }
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<TransferLocationResponse> transferLocationStock({
    required String fromLocationId,
    required String toLocationId,
    bool fullTransfer = true,
    List<TransferLocationLineInput> lines = const <TransferLocationLineInput>[],
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/inventory/movements/transfer-location',
        data: <String, Object>{
          'from_location_id': fromLocationId,
          'to_location_id': toLocationId,
          'mode': fullTransfer ? 'full' : 'partial',
          if (!fullTransfer)
            'lines': lines
                .map(
                  (TransferLocationLineInput l) => <String, Object>{
                    'product_id': l.productId,
                    'lot_id': l.lotId,
                    'qty': l.qty,
                  },
                )
                .toList(growable: false),
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
