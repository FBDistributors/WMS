import 'package:flutter/widgets.dart';

/// Klaviatura (`viewInsets`) + tizim UI / home indikatori (`padding`) pastgi bo‘shliq.
double sheetBottomPadding(BuildContext context) {
  final MediaQueryData mq = MediaQuery.of(context);
  return mq.viewInsets.bottom + mq.padding.bottom;
}
