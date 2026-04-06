import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../storage/shared_preferences_provider.dart';
import 'prefs_keys.dart';
import 'profile_type.dart';

final profileTypeProvider = NotifierProvider<ProfileTypeController, ProfileType>(
  ProfileTypeController.new,
);

class ProfileTypeController extends Notifier<ProfileType> {
  @override
  ProfileType build() {
    final String? stored =
        ref.read(sharedPreferencesProvider).getString(PrefsKeys.profileType);
    return profileTypeFromStorage(stored);
  }

  Future<void> setProfileType(ProfileType type) async {
    state = type;
    await ref.read(sharedPreferencesProvider).setString(
          PrefsKeys.profileType,
          type.storageValue,
        );
  }
}
