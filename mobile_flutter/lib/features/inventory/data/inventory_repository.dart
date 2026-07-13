import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';
import 'models/picker_inventory_models.dart';

class InventoryRepository {
  InventoryRepository(this._dio);

  static const String _invPath = '/inventory';

  final Dio _dio;

  Future<PickerInventoryListResponse> listPickerInventory({
    String? q,
    String? locationId,
    String? brand,
    String? warehouse,
    int limit = 100,
    String? cursor,
  }) async {
    final Map<String, dynamic> query = <String, dynamic>{
      'limit': limit,
      if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
      if (locationId != null && locationId.isNotEmpty) 'location_id': locationId,
      if (brand != null && brand.trim().isNotEmpty) 'brand': brand.trim(),
      if (warehouse != null && warehouse.trim().isNotEmpty) 'warehouse': warehouse.trim(),
      if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
    };

    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '$_invPath/picker',
        queryParameters: query,
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('Invalid inventory list response');
      }
      return PickerInventoryListResponse.fromJson(
        Map<String, Object?>.from(data),
      );
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<List<PickerLocationOption>> listPickerLocations({String? warehouse}) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '$_invPath/picker/locations',
        queryParameters: warehouse != null && warehouse.isNotEmpty
            ? <String, String>{'warehouse': warehouse}
            : null,
      );
      final Object? data = res.data;
      if (data is! List) {
        return const <PickerLocationOption>[];
      }
      return data
          .whereType<Map<dynamic, dynamic>>()
          .map((Map<dynamic, dynamic> m) => PickerLocationOption.fromJson(
                Map<String, Object?>.from(m),
              ))
          .toList(growable: false);
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<List<String>> listPickerBrands() async {
    try {
      final Response<Object?> res = await _dio.get<Object?>('$_invPath/picker/brands');
      final Object? data = res.data;
      if (data is! List) {
        return const <String>[];
      }
      return data
          .whereType<String>()
          .where((String s) => s.trim().isNotEmpty)
          .toList(growable: false);
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<PickerProductDetailResponse> getPickerProductDetail(
    String productId, {
    String? warehouse,
  }) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '$_invPath/picker/$productId',
        queryParameters: warehouse != null && warehouse.isNotEmpty
            ? <String, String>{'warehouse': warehouse}
            : null,
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('product detail');
      }
      return PickerProductDetailResponse.fromJson(
        Map<String, Object?>.from(data),
      );
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<InventoryByBarcodeResponse> getInventoryByBarcode(String barcode) async {
    final String trimmed = barcode.trim();
    if (trimmed.isEmpty) {
      throw Exception('Barcode bo‘sh bo‘lmasligi kerak');
    }
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '$_invPath/by-barcode/${Uri.encodeComponent(trimmed)}',
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('by-barcode');
      }
      return InventoryByBarcodeResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<LocationContentsResponse> getLocationContents(String locationCode) async {
    final String code = locationCode.trim();
    if (code.isEmpty) {
      throw Exception('Lokatsiya kodi bo‘sh bo‘lmasligi kerak');
    }
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '$_invPath/location/${Uri.encodeComponent(code)}',
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('location contents');
      }
      return LocationContentsResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}
