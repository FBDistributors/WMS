import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';
import '../domain/sector_transfer_status.dart';

/// HTTP 403 on POST /inventory/movements (inventory adjust permission).
class StockMovementForbiddenException implements Exception {
  const StockMovementForbiddenException();
}

class TransferLocationResponse {
  const TransferLocationResponse({
    required this.linesTransferred,
    required this.movementsCreated,
    required this.linesRequested,
    required this.boxesTransferred,
  });

  final int linesTransferred;
  final int movementsCreated;
  final int linesRequested;

  /// Full rejimda joy bilan birga ko'chirilgan yopiq qutilar soni.
  final int boxesTransferred;

  factory TransferLocationResponse.fromJson(Map<String, Object?> json) {
    return TransferLocationResponse(
      linesTransferred: _int(json['lines_transferred']),
      movementsCreated: _int(json['movements_created']),
      linesRequested: _int(json['lines_requested']),
      boxesTransferred: _int(json['boxes_transferred']),
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

/// Sektor ko'chirish rejasining bitta qatori: bitta manba joyi va uning manzili.
class SectorTransferRow {
  const SectorTransferRow({
    required this.fromCode,
    required this.toCode,
    required this.lines,
    required this.totalQty,
    required this.boxes,
    required this.status,
    required this.movable,
  });

  final String fromCode;

  /// Manzil joyi; `null` — mos o'rin topilmadi (`dest_missing`).
  final String? toCode;
  final int lines;
  final int totalQty;
  final int boxes;

  /// ok | empty | dest_missing | reserved | expiry_conflict | dest_not_empty
  final String status;

  /// Bu joy haqiqatan ko'chadimi (ogohlantirish bilan bo'lsa ham).
  final bool movable;

  /// Butun amalni bloklovchi holatmi.
  bool get blocking => kSectorBlockingStatuses.contains(status);

  factory SectorTransferRow.fromJson(Map<String, Object?> json) {
    return SectorTransferRow(
      fromCode: (json['from_code'] as String?) ?? '',
      toCode: json['to_code'] as String?,
      lines: _int(json['lines']),
      totalQty: _int(json['total_qty']),
      boxes: _int(json['boxes']),
      status: (json['status'] as String?) ?? kSectorStatusOk,
      movable: json['movable'] == true,
    );
  }
}

/// Sektor ko'chirishdan oldingi ko'rinish.
class SectorTransferPreview {
  const SectorTransferPreview({
    required this.fromPrefix,
    required this.toPrefix,
    required this.canSubmit,
    required this.locationsTotal,
    required this.locationsToMove,
    required this.linesToMove,
    required this.boxesToMove,
    required this.totalQtyToMove,
    required this.rows,
  });

  final String fromPrefix;
  final String toPrefix;

  /// Bloklovchi qator yo'q va kamida bitta joy ko'chadi.
  final bool canSubmit;
  final int locationsTotal;
  final int locationsToMove;
  final int linesToMove;
  final int boxesToMove;
  final int totalQtyToMove;
  final List<SectorTransferRow> rows;

  List<SectorTransferRow> get blockingRows =>
      rows.where((SectorTransferRow r) => r.blocking).toList(growable: false);

  factory SectorTransferPreview.fromJson(Map<String, Object?> json) {
    final Object? rawRows = json['rows'];
    return SectorTransferPreview(
      fromPrefix: (json['from_prefix'] as String?) ?? '',
      toPrefix: (json['to_prefix'] as String?) ?? '',
      canSubmit: json['can_submit'] == true,
      locationsTotal: _int(json['locations_total']),
      locationsToMove: _int(json['locations_to_move']),
      linesToMove: _int(json['lines_to_move']),
      boxesToMove: _int(json['boxes_to_move']),
      totalQtyToMove: _int(json['total_qty_to_move']),
      rows: rawRows is List
          ? rawRows
              .whereType<Map<Object?, Object?>>()
              .map((Map<Object?, Object?> e) =>
                  SectorTransferRow.fromJson(Map<String, Object?>.from(e)))
              .toList(growable: false)
          : const <SectorTransferRow>[],
    );
  }
}

class SectorTransferResponse {
  const SectorTransferResponse({
    required this.fromPrefix,
    required this.toPrefix,
    required this.locationsTransferred,
    required this.linesTransferred,
    required this.boxesTransferred,
  });

  final String fromPrefix;
  final String toPrefix;
  final int locationsTransferred;
  final int linesTransferred;
  final int boxesTransferred;

  factory SectorTransferResponse.fromJson(Map<String, Object?> json) {
    return SectorTransferResponse(
      fromPrefix: (json['from_prefix'] as String?) ?? '',
      toPrefix: (json['to_prefix'] as String?) ?? '',
      locationsTransferred: _int(json['locations_transferred']),
      linesTransferred: _int(json['lines_transferred']),
      boxesTransferred: _int(json['boxes_transferred']),
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
    String? idempotencyKey,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/inventory/movements',
        options: idempotencyKey != null && idempotencyKey.isNotEmpty
            ? Options(headers: <String, String>{'Idempotency-Key': idempotencyKey})
            : null,
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
    String? idempotencyKey,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/inventory/movements/transfer-location',
        options: idempotencyKey != null && idempotencyKey.isNotEmpty
            ? Options(headers: <String, String>{'Idempotency-Key': idempotencyKey})
            : null,
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
  /// Sektorni ko'chirishdan oldingi ko'rinish — hech narsani o'zgartirmaydi.
  Future<SectorTransferPreview> previewSectorTransfer({
    required String fromSector,
    required String toSector,
  }) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '/inventory/movements/sector-transfer/preview',
        queryParameters: <String, Object?>{'from': fromSector, 'to': toSector},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('sector-preview');
      }
      return SectorTransferPreview.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  /// Butun sektorni ko'chiradi (hammasi yoki hech narsa).
  Future<SectorTransferResponse> transferSector({
    required String fromSector,
    required String toSector,
    String? idempotencyKey,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/inventory/movements/sector-transfer',
        options: idempotencyKey != null && idempotencyKey.isNotEmpty
            ? Options(headers: <String, String>{'Idempotency-Key': idempotencyKey})
            : null,
        data: <String, Object>{
          'from_sector': fromSector,
          'to_sector': toSector,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('sector-transfer');
      }
      return SectorTransferResponse.fromJson(Map<String, Object?>.from(data));
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
