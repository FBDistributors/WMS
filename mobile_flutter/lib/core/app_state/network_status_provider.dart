import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// RN `NetworkProvider` ga yaqin: tarmoq bor-yo‘qligi.
final networkOnlineProvider = StreamProvider<bool>((Ref ref) {
  return Connectivity().onConnectivityChanged.map((List<ConnectivityResult> r) {
    return !r.contains(ConnectivityResult.none);
  });
});

final networkInitializedProvider = FutureProvider<bool>((Ref ref) async {
  await Connectivity().checkConnectivity();
  return true;
});
