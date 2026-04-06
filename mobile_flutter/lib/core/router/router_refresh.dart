import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/presentation/auth_providers.dart';

/// `GoRouter` ni auth o‘zgarishlarida qayta `redirect` qilish uchun.
final goRouterRefreshProvider = Provider<GoRouterRefreshNotifier>((Ref ref) {
  final GoRouterRefreshNotifier notifier = GoRouterRefreshNotifier(ref);
  ref.onDispose(notifier.dispose);
  return notifier;
});

class GoRouterRefreshNotifier extends ChangeNotifier {
  GoRouterRefreshNotifier(this._ref) {
    _ref.listen<AsyncValue<AuthSession>>(
      authControllerProvider,
      (_, __) => notifyListeners(),
    );
  }

  final Ref _ref;
}
