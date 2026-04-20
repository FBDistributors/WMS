import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import 'data/vip_customers_repository.dart';

final vipCustomersRepositoryProvider = Provider<VipCustomersRepository>((Ref ref) {
  return VipCustomersRepository(ref.watch(appDioProvider));
});
