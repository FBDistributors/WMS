import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';
import 'box_location_models.dart';

class BoxLocationRepository {
  BoxLocationRepository(this._dio);

  final Dio _dio;

  Future<BoxLocationBreakdown> getBreakdown({
    required String productId,
    required String lotId,
    required String locationId,
  }) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '/box-locations/breakdown',
        queryParameters: <String, String>{
          'product_id': productId,
          'lot_id': lotId,
          'location_id': locationId,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('box breakdown');
      }
      return BoxLocationBreakdown.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<BoxLocationBreakdown> placeBox({
    required String boxBarcode,
    required String locationId,
    required String lotId,
    int boxCount = 1,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/box-locations/place',
        data: <String, Object?>{
          'box_barcode': boxBarcode.trim(),
          'location_id': locationId,
          'lot_id': lotId,
          if (boxCount > 1) 'box_count': boxCount,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('box place');
      }
      return BoxLocationBreakdown.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<BoxLocationBreakdown> removeBox({
    required String boxBarcode,
    String? locationId,
    String? lotId,
    String reason = 'inventory',
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/box-locations/remove',
        data: <String, Object?>{
          'box_barcode': boxBarcode.trim(),
          if (locationId != null) 'location_id': locationId,
          if (lotId != null) 'lot_id': lotId,
          'reason': reason,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('box remove');
      }
      return BoxLocationBreakdown.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  /// Inventarizatsiya sanog'i: yopiq quti soni va qutisiz dona aniq belgilanadi
  /// (total va sealed chelagi birga to'g'rilanadi).
  Future<BoxLocationBreakdown> countBox({
    required String boxBarcode,
    required String locationId,
    required String lotId,
    required int boxCount,
    required int looseUnits,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/box-locations/count',
        data: <String, Object?>{
          'box_barcode': boxBarcode.trim(),
          'location_id': locationId,
          'lot_id': lotId,
          'box_count': boxCount,
          'loose_units': looseUnits,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('box count');
      }
      return BoxLocationBreakdown.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<BoxLocationBreakdown> transferBox({
    required String boxBarcode,
    required String fromLocationId,
    required String toLocationId,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/box-locations/transfer',
        data: <String, Object?>{
          'box_barcode': boxBarcode.trim(),
          'from_location_id': fromLocationId,
          'to_location_id': toLocationId,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('box transfer');
      }
      return BoxLocationBreakdown.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}
