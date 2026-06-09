import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';
import 'product_box_models.dart';

class ProductBoxNotFoundException implements Exception {
  const ProductBoxNotFoundException();
}

class ProductBoxRepository {
  ProductBoxRepository(this._dio);

  final Dio _dio;

  Future<ProductBoxResolve> resolveByBarcode(String barcode) async {
    final String code = barcode.trim();
    if (code.isEmpty) {
      throw const ProductBoxNotFoundException();
    }
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '/product-boxes/by-barcode/${Uri.encodeComponent(code)}',
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const ProductBoxNotFoundException();
      }
      return ProductBoxResolve.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) {
        throw const ProductBoxNotFoundException();
      }
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<List<ProductBoxSummary>> listByProduct(String productId) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '/product-boxes',
        queryParameters: <String, Object?>{
          'product_id': productId,
          'active_only': true,
          'limit': 100,
        },
      );
      final Object? data = res.data;
      if (data is! List) {
        return const <ProductBoxSummary>[];
      }
      return data
          .whereType<Map<dynamic, dynamic>>()
          .map(
            (Map<dynamic, dynamic> m) => ProductBoxSummary.fromJson(
              Map<String, Object?>.from(m),
            ),
          )
          .toList(growable: false);
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<ProductBoxResolve> create(ProductBoxCreate payload) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/product-boxes',
        data: payload.toJson(),
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('product-box create');
      }
      final Map<String, Object?> m = Map<String, Object?>.from(data);
      return ProductBoxResolve(
        productId: '${m['product_id']}',
        unitsPerBox: (m['units_per_box'] as num?)?.round() ?? payload.unitsPerBox,
        boxId: '${m['id']}',
        productName: '',
        productSku: '',
        productBarcode: null,
      );
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}
