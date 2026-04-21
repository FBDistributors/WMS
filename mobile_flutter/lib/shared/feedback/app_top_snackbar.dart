import 'package:flutter/material.dart';

enum AppToastType { success, error, warning, info }

const Duration _kTopSnackMinComfort = Duration(seconds: 3);
const Duration _kTopSnackDefaultLong = Duration(seconds: 4);
const Duration _kTopSnackEnterDuration = Duration(milliseconds: 220);
const Duration _kTopSnackExitDuration = Duration(milliseconds: 320);
const Curve _kTopSnackEnterCurve = Curves.easeOutCubic;
const Curve _kTopSnackExitCurve = Curves.easeInCubic;

_TopToastHandle? _activeTopToast;

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
void showAppSnackBar(
  BuildContext context,
  SnackBar snackBar, {
  AppToastType type = AppToastType.info,
}) {
  final OverlayState? overlay = Overlay.maybeOf(context, rootOverlay: true);
  if (overlay == null) {
    return;
  }

  final NavigatorState navigator = Navigator.of(context, rootNavigator: true);
  _activeTopToast?.dismiss(immediate: true);

  final AnimationController controller = AnimationController(
    vsync: navigator,
    duration: _kTopSnackEnterDuration,
    reverseDuration: _kTopSnackExitDuration,
  );

  final CurvedAnimation fadeAnimation = CurvedAnimation(
    parent: controller,
    curve: _kTopSnackEnterCurve,
    reverseCurve: _kTopSnackExitCurve,
  );
  final Animation<Offset> slideAnimation = Tween<Offset>(
    begin: const Offset(0, -0.15),
    end: Offset.zero,
  ).animate(fadeAnimation);

  final _TopToastHandle handle = _TopToastHandle(controller: controller);
  late final OverlayEntry entry;
  entry = OverlayEntry(
    builder: (BuildContext overlayContext) {
      final ThemeData theme = Theme.of(overlayContext);
      final SnackBarThemeData barTheme = theme.snackBarTheme;
      final EdgeInsets margin = _topSnackBarMargin(overlayContext);

      final Color bgColor = _toastBgColor(type);
      const Color fgColor = Colors.white;
      final ShapeBorder shape =
          snackBar.shape ??
          barTheme.shape ??
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(999));
      final double elevation = snackBar.elevation ?? 0;
      final Clip clipBehavior = snackBar.clipBehavior;
      final EdgeInsetsGeometry padding =
          snackBar.padding ??
          const EdgeInsets.symmetric(horizontal: 8, vertical: 5);
      final IconData leadingIcon = _toastIcon(type);

      return Positioned(
        left: 0,
        right: 0,
        top: margin.top,
        child: Material(
          type: MaterialType.transparency,
          child: IgnorePointer(
            ignoring: false,
            child: FadeTransition(
              opacity: fadeAnimation,
              child: SlideTransition(
                position: slideAnimation,
                child: Dismissible(
                  key: ValueKey<int>(entry.hashCode),
                  direction: DismissDirection.up,
                  onDismissed: (_) => handle.dismiss(),
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: margin.left),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          maxWidth:
                              MediaQuery.sizeOf(overlayContext).width - margin.horizontal,
                        ),
                        child: Material(
                          color: bgColor,
                          shape: shape,
                          elevation: elevation,
                          clipBehavior: clipBehavior,
                          child: Padding(
                            padding: padding,
                            child: _TopSnackBarContent(
                              content: snackBar.content,
                              contentTextStyle:
                                  barTheme.contentTextStyle ??
                                  theme.textTheme.bodyMedium?.copyWith(
                                    color: fgColor,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    height: 1.0,
                                  ),
                              leadingIcon: leadingIcon,
                              leadingColor: fgColor,
                              action: snackBar.action,
                              showCloseIcon: snackBar.showCloseIcon ?? false,
                              closeIconColor:
                                  snackBar.closeIconColor ??
                                  barTheme.closeIconColor ??
                                  fgColor,
                              onClose: handle.dismiss,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    },
  );

  handle.attach(
    entry: entry,
    timeout: _topSnackDuration(snackBar),
    onDisposed: () {
      if (identical(_activeTopToast, handle)) {
        _activeTopToast = null;
      }
    },
  );
  _activeTopToast = handle;
  overlay.insert(entry);
  controller.forward();
}

void showAppSnackBarMessage(
  BuildContext context,
  String text, {
  Duration? duration,
  SnackBarAction? action,
  AppToastType type = AppToastType.info,
}) {
  showAppSnackBar(
    context,
    SnackBar(
      content: Text(text),
      duration: duration ?? _kTopSnackDefaultLong,
      action: action,
    ),
    type: type,
  );
}

void showAppTopStatusText(
  BuildContext context,
  String text, {
  Duration duration = const Duration(seconds: 2),
}) {
  showAppSnackBar(
    context,
    SnackBar(
      content: Text(text, textAlign: TextAlign.center),
      duration: duration,
      backgroundColor: Colors.transparent,
      elevation: 0,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(0)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
    ),
    type: AppToastType.info,
  );
}

void showAppTopSuccess(
  BuildContext context,
  String text, {
  Duration duration = const Duration(seconds: 2),
}) {
  showAppSnackBar(
    context,
    SnackBar(
      content: Text(text, textAlign: TextAlign.center),
      duration: duration,
      showCloseIcon: false,
    ),
    type: AppToastType.success,
  );
}

class _TopSnackBarContent extends StatelessWidget {
  const _TopSnackBarContent({
    required this.content,
    required this.contentTextStyle,
    required this.leadingIcon,
    required this.leadingColor,
    required this.action,
    required this.showCloseIcon,
    required this.closeIconColor,
    required this.onClose,
  });

  final Widget content;
  final TextStyle? contentTextStyle;
  final IconData leadingIcon;
  final Color leadingColor;
  final SnackBarAction? action;
  final bool showCloseIcon;
  final Color closeIconColor;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final Widget centeredContent = _centeredToastContent(content);
    final double maxTextWidth = MediaQuery.sizeOf(context).width * 0.46;
    final List<Widget> rowChildren = <Widget>[
      Icon(leadingIcon, color: leadingColor, size: 14),
      const SizedBox(width: 3),
      ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxTextWidth),
        child: Align(
          alignment: Alignment.center,
          widthFactor: 1,
          child: DefaultTextStyle(
            style: contentTextStyle ?? const TextStyle(),
            textAlign: TextAlign.center,
            child: centeredContent,
          ),
        ),
      ),
    ];

    if (action != null) {
      rowChildren.add(const SizedBox(width: 3));
      rowChildren.add(action!);
    }
    if (showCloseIcon) {
      rowChildren.add(const SizedBox(width: 4));
      rowChildren.add(
        IconButton(
          visualDensity: VisualDensity.compact,
          splashRadius: 18,
          icon: Icon(Icons.close_rounded, color: closeIconColor),
          onPressed: onClose,
        ),
      );
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: rowChildren,
    );
  }
}

Widget _centeredToastContent(Widget content) {
  if (content is Text) {
    if (content.data != null) {
      return Text(
        content.data!,
        key: content.key,
        style: content.style,
        strutStyle: content.strutStyle,
        textAlign: TextAlign.center,
        textDirection: content.textDirection,
        locale: content.locale,
        softWrap: content.softWrap,
        overflow: content.overflow,
        textScaler: content.textScaler,
        maxLines: content.maxLines,
        semanticsLabel: content.semanticsLabel,
        textWidthBasis: content.textWidthBasis,
        textHeightBehavior: content.textHeightBehavior,
      );
    }
    if (content.textSpan != null) {
      return Text.rich(
        content.textSpan!,
        key: content.key,
        style: content.style,
        strutStyle: content.strutStyle,
        textAlign: TextAlign.center,
        textDirection: content.textDirection,
        locale: content.locale,
        softWrap: content.softWrap,
        overflow: content.overflow,
        textScaler: content.textScaler,
        maxLines: content.maxLines,
        semanticsLabel: content.semanticsLabel,
        textWidthBasis: content.textWidthBasis,
        textHeightBehavior: content.textHeightBehavior,
      );
    }
  }
  return content;
}

Color _toastBgColor(AppToastType type) {
  switch (type) {
    case AppToastType.success:
      return Colors.green.shade600;
    case AppToastType.error:
      return Colors.red.shade600;
    case AppToastType.warning:
      return Colors.orange.shade700;
    case AppToastType.info:
      return Colors.blue.shade600;
  }
}

IconData _toastIcon(AppToastType type) {
  switch (type) {
    case AppToastType.success:
      return Icons.check_circle_rounded;
    case AppToastType.error:
      return Icons.error_rounded;
    case AppToastType.warning:
      return Icons.warning_amber_rounded;
    case AppToastType.info:
      return Icons.info_rounded;
  }
}

class _TopToastHandle {
  _TopToastHandle({required this.controller});

  final AnimationController controller;
  OverlayEntry? _entry;
  VoidCallback? _onDisposed;
  bool _disposed = false;

  void attach({
    required OverlayEntry entry,
    required Duration timeout,
    required VoidCallback onDisposed,
  }) {
    _entry = entry;
    _onDisposed = onDisposed;
    Future<void>.delayed(timeout, () {
      if (!_disposed) {
        dismiss();
      }
    });
  }

  Future<void> dismiss({bool immediate = false}) async {
    if (_disposed) {
      return;
    }
    _disposed = true;
    try {
      if (!immediate && controller.status != AnimationStatus.dismissed) {
        await controller.reverse();
      }
    } finally {
      _entry?.remove();
      controller.dispose();
      _onDisposed?.call();
      _entry = null;
      _onDisposed = null;
    }
  }
}
