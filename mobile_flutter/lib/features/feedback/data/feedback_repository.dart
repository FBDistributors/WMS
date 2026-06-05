import 'dart:io' show Platform;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb, defaultTargetPlatform, TargetPlatform;

import '../../../core/network/app_dio.dart';

class FeedbackSubmitPayload {
  const FeedbackSubmitPayload({
    required this.rating,
    required this.role,
    required this.module,
    this.comment,
    this.contextRef,
    this.appVersion,
    this.platform,
  });

  final int rating;
  final String role;
  final String module;
  final String? comment;
  final String? contextRef;
  final String? appVersion;
  final String? platform;

  Map<String, Object?> toJson() => <String, Object?>{
        'rating': rating,
        'role': role,
        'module': module,
        if (comment != null && comment!.isNotEmpty) 'comment': comment,
        if (contextRef != null && contextRef!.isNotEmpty) 'context_ref': contextRef,
        if (appVersion != null && appVersion!.isNotEmpty) 'app_version': appVersion,
        if (platform != null && platform!.isNotEmpty) 'platform': platform,
      };
}

class FeedbackRepository {
  FeedbackRepository(this._dio);

  static const String _path = '/app-feedback';
  final Dio _dio;

  Future<void> submitFeedback(FeedbackSubmitPayload payload) async {
    try {
      await _dio.post<Object?>(_path, data: payload.toJson());
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}

const String kAppFeedbackVersion = '1.0.0+3';

String detectFeedbackPlatform() {
  if (kIsWeb) {
    return 'web';
  }
  if (Platform.isAndroid) {
    return 'android';
  }
  if (Platform.isIOS) {
    return 'ios';
  }
  return switch (defaultTargetPlatform) {
    TargetPlatform.android => 'android',
    TargetPlatform.iOS => 'ios',
    TargetPlatform.linux => 'linux',
    TargetPlatform.macOS => 'macos',
    TargetPlatform.windows => 'windows',
    TargetPlatform.fuchsia => 'fuchsia',
  };
}
