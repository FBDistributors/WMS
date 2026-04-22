import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import 'data/customer_returns_models.dart';
import 'data/customer_returns_repository.dart';

/// Skanerdan qaytgan lokatsiya — [CustomerReturnDetailScreen] `ref.listen` orqali qabul qiladi.
class CustomerReturnLocationScanFromScanner {
  const CustomerReturnLocationScanFromScanner({
    required this.returnId,
    required this.lineId,
    required this.locationId,
    required this.displayLabel,
  });

  final String returnId;
  final String lineId;
  final String locationId;
  final String displayLabel;
}

final pendingCustomerReturnLocationScanProvider =
    StateProvider<CustomerReturnLocationScanFromScanner?>((Ref ref) => null);

final customerReturnsRepositoryProvider = Provider<CustomerReturnsRepository>((Ref ref) {
  return CustomerReturnsRepository(ref.watch(appDioProvider));
});

final customerReturnsQueueProvider =
    FutureProvider.autoDispose<CustomerReturnListResponse>(
  (Ref ref) => ref.watch(customerReturnsRepositoryProvider).listCustomerReturns(
        mineAsPicker: true,
        limit: 50,
      ),
);

final customerReturnsAssignedCountProvider = Provider.autoDispose<int>((Ref ref) {
  return ref.watch(customerReturnsQueueProvider).maybeWhen(
        data: (CustomerReturnListResponse r) => r.total,
        orElse: () => 0,
      );
});

final customerReturnDetailProvider =
    FutureProvider.autoDispose.family<CustomerReturn, String>(
  (Ref ref, String returnId) =>
      ref.watch(customerReturnsRepositoryProvider).getCustomerReturn(returnId),
);
