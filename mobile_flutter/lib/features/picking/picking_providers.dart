import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import 'data/picking_models.dart';
import 'data/picking_repository.dart';

final pickingRepositoryProvider = Provider<PickingRepository>((Ref ref) {
  return PickingRepository(ref.watch(appDioProvider));
});

final openPickTasksProvider = FutureProvider.autoDispose<List<PickingListItem>>(
  (Ref ref) => ref.watch(pickingRepositoryProvider).getOpenTasks(),
);

final pickerStatsProvider = FutureProvider.autoDispose<MyPickerStats>(
  (Ref ref) => ref.watch(pickingRepositoryProvider).getMyPickerStats(),
);

final pickTaskDetailProvider =
    FutureProvider.autoDispose.family<PickingDocument, String>(
  (Ref ref, String taskId) =>
      ref.watch(pickingRepositoryProvider).getTaskById(taskId),
);

final consolidatedViewProvider =
    FutureProvider.autoDispose<ConsolidatedViewResponse>(
  (Ref ref) => ref.watch(pickingRepositoryProvider).getConsolidatedView(),
);
