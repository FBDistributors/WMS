import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Skan rad etilganda aniq seziladi — ombor TSD qurilmalarida bitta `heavyImpact` yetarli emas.
void triggerRejectScanHaptic() {
  unawaited(_pulseRejectScanHaptic());
}

Future<void> _pulseRejectScanHaptic() async {
  await HapticFeedback.heavyImpact();
  if (defaultTargetPlatform == TargetPlatform.android) {
    await HapticFeedback.vibrate();
  }
  await Future<void>.delayed(const Duration(milliseconds: 70));
  await HapticFeedback.heavyImpact();
}
