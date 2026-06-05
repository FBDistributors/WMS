import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import 'data/feedback_repository.dart';

final feedbackRepositoryProvider = Provider<FeedbackRepository>((Ref ref) {
  return FeedbackRepository(ref.watch(appDioProvider));
});
