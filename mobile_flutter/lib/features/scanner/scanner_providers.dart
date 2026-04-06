import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import 'data/scanner_repository.dart';

final scannerRepositoryProvider = Provider<ScannerRepository>((Ref ref) {
  return ScannerRepository(ref.watch(appDioProvider));
});
