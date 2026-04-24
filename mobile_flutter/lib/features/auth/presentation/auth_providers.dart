import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/app_dio.dart';
import '../../../core/storage/auth_token_storage.dart';
import '../../../core/app_state/profile_type.dart';
import '../../../core/app_state/profile_type_controller.dart';
import '../data/auth_models.dart';
import '../data/auth_repository.dart';

final authRepositoryProvider = Provider<AuthRepository>((Ref ref) {
  return AuthRepository(
    ref.watch(appDioProvider),
    ref.watch(authTokenStorageProvider),
  );
});

final authControllerProvider =
    AsyncNotifierProvider<AuthController, AuthSession>(AuthController.new);

class AuthSession {
  const AuthSession.unauthenticated() : me = null;
  const AuthSession.authenticated(this.me);

  final MeResponse? me;

  bool get isAuthenticated => me != null;
}

class AuthController extends AsyncNotifier<AuthSession> {
  @override
  Future<AuthSession> build() async {
    final AuthTokenStorage storage = ref.read(authTokenStorageProvider);
    final String? token = storage.readToken();
    if (token == null || token.isEmpty) {
      return const AuthSession.unauthenticated();
    }
    try {
      final MeResponse me = await ref.read(authRepositoryProvider).getMe();
      final ProfileType pt = me.profileKind == ProfileRoleKind.controller
          ? ProfileType.controller
          : ProfileType.picker;
      await ref.read(profileTypeProvider.notifier).setProfileType(pt);
      return AuthSession.authenticated(me);
    } on Exception {
      await storage.writeToken(null);
      return const AuthSession.unauthenticated();
    }
  }

  Future<bool> login(String username, String password) async {
    final AsyncValue<AuthSession> next = await AsyncValue.guard(() async {
      await ref.read(authRepositoryProvider).login(
            username: username,
            password: password,
          );
      final MeResponse me = await ref.read(authRepositoryProvider).getMe();
      final ProfileType pt = me.profileKind == ProfileRoleKind.controller
          ? ProfileType.controller
          : ProfileType.picker;
      await ref.read(profileTypeProvider.notifier).setProfileType(pt);
      return AuthSession.authenticated(me);
    });
    state = next;
    return next.maybeWhen(
      data: (AuthSession s) => s.isAuthenticated,
      orElse: () => false,
    );
  }

  Future<void> logout() async {
    await ref.read(authRepositoryProvider).logout();
    state = const AsyncData(AuthSession.unauthenticated());
  }

  Future<void> refreshMe() async {
    final AuthSession? current = state.value;
    if (current == null || !current.isAuthenticated) {
      return;
    }
    state = await AsyncValue.guard(() async {
      final MeResponse me = await ref.read(authRepositoryProvider).getMe();
      return AuthSession.authenticated(me);
    });
  }
}
