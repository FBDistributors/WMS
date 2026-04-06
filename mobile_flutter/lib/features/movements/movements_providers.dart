import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import 'data/movements_repository.dart';

final movementsRepositoryProvider = Provider<MovementsRepository>((Ref ref) {
  return MovementsRepository(ref.watch(appDioProvider));
});
