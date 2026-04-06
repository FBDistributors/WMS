import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import 'data/receiving_repository.dart';

final receivingRepositoryProvider = Provider<ReceivingRepository>((Ref ref) {
  return ReceivingRepository(ref.watch(appDioProvider));
});
