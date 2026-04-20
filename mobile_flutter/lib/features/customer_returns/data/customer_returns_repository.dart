import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';
import 'customer_returns_models.dart';

class CustomerReturnsRepository {
  CustomerReturnsRepository(this._dio);

  static const String _path = '/customer-returns';
  final Dio _dio;

  Future<CustomerReturnListResponse> listCustomerReturns({
    String? status,
    bool? mineAsPicker,
    int? limit,
    int? offset,
  }) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        _path,
        queryParameters: <String, Object?>{
          if (status != null) 'status': status,
          if (mineAsPicker == true) 'mine_as_picker': true,
          if (limit != null) 'limit': limit,
          if (offset != null) 'offset': offset,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('customer returns list');
      }
      return CustomerReturnListResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<CustomerReturn> getCustomerReturn(String id) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>('$_path/$id');
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('customer return');
      }
      return CustomerReturn.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<CustomerReturn> createCustomerReturn({
    String? docNo,
    String? customerId,
    String? customerName,
    required List<CreateCustomerReturnLine> lines,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        _path,
        data: <String, Object?>{
          if (docNo != null) 'doc_no': docNo,
          if (customerId != null && customerId.isNotEmpty) 'customer_id': customerId,
          if (customerName != null && customerName.isNotEmpty) 'customer_name': customerName,
          'lines': lines.map((CreateCustomerReturnLine e) => e.toJson()).toList(),
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('create return');
      }
      return CustomerReturn.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<CustomerReturn> controllerApprove(String id) async {
    try {
      final Response<Object?> res =
          await _dio.post<Object?>('$_path/$id/controller-approve');
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('approve');
      }
      return CustomerReturn.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<CustomerReturn> assignPicker(String id, String pickerUserId) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '$_path/$id/assign-picker',
        data: <String, String>{'picker_user_id': pickerUserId},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('assign');
      }
      return CustomerReturn.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<CustomerReturn> completeCustomerReturn(String id) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>('$_path/$id/complete');
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('complete');
      }
      return CustomerReturn.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}
