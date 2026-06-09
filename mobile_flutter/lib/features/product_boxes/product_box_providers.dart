import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import 'data/box_location_repository.dart';
import 'data/product_box_repository.dart';

final productBoxRepositoryProvider = Provider<ProductBoxRepository>((Ref ref) {
  return ProductBoxRepository(ref.watch(appDioProvider));
});

final boxLocationRepositoryProvider = Provider<BoxLocationRepository>((Ref ref) {
  return BoxLocationRepository(ref.watch(appDioProvider));
});
