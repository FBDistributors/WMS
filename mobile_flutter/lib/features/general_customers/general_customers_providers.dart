import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import 'data/general_customers_repository.dart';

final generalCustomersRepositoryProvider = Provider<GeneralCustomersRepository>((Ref ref) {
  return GeneralCustomersRepository(ref.watch(appDioProvider));
});
