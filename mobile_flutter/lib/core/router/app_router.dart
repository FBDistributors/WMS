import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/account/presentation/account_screen.dart';
import '../../features/auth/login_screen.dart';
import '../../features/auth/presentation/auth_providers.dart';
import '../../features/inventory/presentation/inventory_detail_screen.dart';
import '../../features/inventory/presentation/inventory_screen.dart';
import '../../features/customer_returns/presentation/customer_returns_queue_screen.dart';
import '../../features/kirim/presentation/kirim_form_screen.dart';
import '../../features/kirim/presentation/kirim_hub_screen.dart';
import '../../features/kirim/presentation/kirim_new_screen.dart';
import '../../features/misc/presentation/stub_screens.dart';
import '../../features/movements/presentation/movement_screen.dart';
import '../../features/picking/presentation/consolidated_pick_screen.dart';
import '../../features/picking/presentation/pick_task_details_screen.dart';
import '../../features/picking/presentation/pick_task_list_screen.dart';
import '../../features/picking/presentation/picker_home_screen.dart';
import '../../features/picking/presentation/picker_work_screen.dart';
import '../../features/queue/presentation/queue_screen.dart';
import '../../features/scanner/presentation/scanner_screen.dart';
import 'router_refresh.dart';
import 'scanner_args.dart';

final goRouterProvider = Provider<GoRouter>((Ref ref) {
  final GoRouterRefreshNotifier refresh = ref.watch(goRouterRefreshProvider);
  return GoRouter(
    initialLocation: '/login',
    refreshListenable: refresh,
    redirect: (BuildContext context, GoRouterState state) {
      final AsyncValue<AuthSession> auth = ref.read(authControllerProvider);
      final String path = state.matchedLocation;
      final bool authed = auth.maybeWhen(
        data: (AuthSession s) => s.isAuthenticated,
        orElse: () => false,
      );
      final bool loggingIn = path == '/login';
      if (auth.isLoading && !loggingIn) {
        return '/login';
      }
      if (!authed && !loggingIn) {
        return '/login';
      }
      if (authed && loggingIn) {
        return '/picker-home';
      }
      return null;
    },
    routes: <RouteBase>[
      GoRoute(
        path: '/login',
        name: 'login',
        builder: (BuildContext context, GoRouterState state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/picker-home',
        name: 'pickerHome',
        builder: (BuildContext context, GoRouterState state) => const PickerHomeScreen(),
      ),
      GoRoute(
        path: '/pick-tasks',
        name: 'pickTasks',
        builder: (BuildContext context, GoRouterState state) => const PickTaskListScreen(),
      ),
      GoRoute(
        path: '/pick-task/:taskId',
        name: 'pickTaskDetail',
        builder: (BuildContext context, GoRouterState state) {
          final String taskId = state.pathParameters['taskId']!;
          return PickTaskDetailsScreen(taskId: taskId);
        },
      ),
      GoRoute(
        path: '/consolidated-pick',
        name: 'consolidatedPick',
        builder: (BuildContext context, GoRouterState state) => const ConsolidatedPickScreen(),
      ),
      GoRoute(
        path: '/picker',
        name: 'picker',
        builder: (BuildContext context, GoRouterState state) {
          final String? taskId = state.uri.queryParameters['taskId'];
          return PickerWorkScreen(taskId: taskId);
        },
      ),
      GoRoute(
        path: '/scanner',
        name: 'scanner',
        builder: (BuildContext context, GoRouterState state) {
          final ScannerArgs? args = state.extra is ScannerArgs ? state.extra! as ScannerArgs : null;
          return ScannerScreen(args: args);
        },
      ),
      GoRoute(
        path: '/account',
        name: 'account',
        builder: (BuildContext context, GoRouterState state) => const AccountScreen(),
      ),
      GoRoute(
        path: '/inventory',
        name: 'inventory',
        builder: (BuildContext context, GoRouterState state) => const InventoryScreen(),
        routes: <RouteBase>[
          GoRoute(
            path: 'detail/:productId',
            name: 'inventoryDetail',
            builder: (BuildContext context, GoRouterState state) {
              final String id = state.pathParameters['productId']!;
              return InventoryDetailScreen(productId: id);
            },
          ),
        ],
      ),
      GoRoute(
        path: '/queue',
        name: 'queue',
        builder: (BuildContext context, GoRouterState state) => const QueueScreen(),
      ),
      GoRoute(
        path: '/returns',
        name: 'returns',
        builder: (BuildContext context, GoRouterState state) => const ReturnsScreen(),
      ),
      GoRoute(
        path: '/kirim',
        name: 'kirim',
        builder: (BuildContext context, GoRouterState state) => const KirimHubScreen(),
      ),
      GoRoute(
        path: '/kirim-new',
        name: 'kirimNew',
        builder: (BuildContext context, GoRouterState state) => const KirimNewScreen(),
      ),
      GoRoute(
        path: '/kirim-form',
        name: 'kirimForm',
        builder: (BuildContext context, GoRouterState state) => const KirimFormScreen(),
      ),
      GoRoute(
        path: '/customer-returns-queue',
        name: 'customerReturnsQueue',
        builder: (BuildContext context, GoRouterState state) => const CustomerReturnsQueueScreen(),
      ),
      GoRoute(
        path: '/movement',
        name: 'movement',
        builder: (BuildContext context, GoRouterState state) => const MovementScreen(),
      ),
    ],
  );
});
