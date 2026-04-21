import 'package:flutter/material.dart';

const Duration _kTopSnackMinComfort = Duration(seconds: 3);
const Duration _kTopSnackDefaultLong = Duration(seconds: 4);

EdgeInsets _topSnackBarMargin(BuildContext context) {
  final double top = MediaQuery.viewPaddingOf(context).top + 8;
  return EdgeInsets.only(top: top, left: 12, right: 12);
}

Duration _topSnackDuration(SnackBar snackBar) {
  if (snackBar.duration >= _kTopSnackMinComfort) {
    return snackBar.duration;
  }
  if (snackBar.duration < const Duration(seconds: 2)) {
    return const Duration(seconds: 2);
  }
  return _kTopSnackDefaultLong;
}

/// Pastki tab/footer bilan to‘qnashmasligi uchun SnackBar yuqorida, sekinroq vaqt + dismiss animatsiyasi.
void showAppSnackBar(BuildContext context, SnackBar snackBar) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: snackBar.content,
      backgroundColor: snackBar.backgroundColor,
      elevation: snackBar.elevation,
      margin: _topSnackBarMargin(context),
      padding: snackBar.padding,
      width: snackBar.width,
      shape: snackBar.shape,
      behavior: SnackBarBehavior.floating,
      action: snackBar.action,
      duration: _topSnackDuration(snackBar),
      dismissDirection: DismissDirection.up,
      clipBehavior: snackBar.clipBehavior,
      actionOverflowThreshold: snackBar.actionOverflowThreshold,
      showCloseIcon: snackBar.showCloseIcon,
      closeIconColor: snackBar.closeIconColor,
    ),
  );
}

void showAppSnackBarMessage(
  BuildContext context,
  String text, {
  Duration? duration,
  SnackBarAction? action,
}) {
  showAppSnackBar(
    context,
    SnackBar(
      content: Text(text),
      duration: duration ?? _kTopSnackDefaultLong,
      action: action,
    ),
  );
}
