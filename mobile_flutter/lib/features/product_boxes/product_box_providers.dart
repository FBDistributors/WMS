import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import 'data/product_box_repository.dart';

final productBoxRepositoryProvider = Provider<ProductBoxRepository>((Ref ref) {
  return ProductBoxRepository(ref.watch(appDioProvider));
});
