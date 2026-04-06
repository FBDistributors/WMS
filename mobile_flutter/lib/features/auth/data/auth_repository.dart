import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';
import '../../../core/storage/auth_token_storage.dart';
import 'auth_models.dart';

class AuthRepository {
  AuthRepository(this._dio, this._tokenStorage);

  final Dio _dio;
  final AuthTokenStorage _tokenStorage;

  Future<TokenResponse> login({
    required String username,
    required String password,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/auth/login',
        data: <String, String>{
          'username': username,
          'password': password,
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('Invalid login response');
      }
      final TokenResponse tokens = TokenResponse.fromJson(
        Map<String, Object?>.from(data),
      );
      await _tokenStorage.writeToken(tokens.accessToken);
      return tokens;
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<MeResponse> getMe() async {
    try {
      final Response<Object?> res = await _dio.get<Object?>('/auth/me');
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('Invalid me response');
      }
      return MeResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<void> logout() async {
    try {
      await _dio.post<Object?>('/auth/logout');
    } catch (_) {
      // ignore
    } finally {
      await _tokenStorage.writeToken(null);
    }
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    try {
      await _dio.post<Object?>(
        '/auth/change-password',
        data: <String, String>{
          'current_password': currentPassword,
          'new_password': newPassword,
        },
      );
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<MeResponse> updateMe({
    String? username,
    String? fullName,
  }) async {
    try {
      final Map<String, Object?> body = <String, Object?>{
        if (username != null) 'username': username,
        if (fullName != null) 'full_name': fullName,
      };
      final Response<Object?> res =
          await _dio.patch<Object?>('/auth/me', data: body);
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('Invalid profile response');
      }
      return MeResponse.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}
