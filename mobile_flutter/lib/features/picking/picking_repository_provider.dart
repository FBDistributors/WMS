import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import 'data/picking_repository.dart';

final pickingRepositoryProvider = Provider<PickingRepository>((Ref ref) {
  return PickingRepository(ref.watch(appDioProvider));
});
