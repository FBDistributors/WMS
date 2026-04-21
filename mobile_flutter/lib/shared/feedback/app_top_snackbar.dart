import 'package:flutter/material.dart';

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
void showAppSnackBar(BuildContext context, SnackBar snackBar) {
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

      final Color bgColor =
          snackBar.backgroundColor ??
          barTheme.backgroundColor ??
          theme.colorScheme.inverseSurface;
      final Color fgColor =
          barTheme.contentTextStyle?.color ?? theme.colorScheme.onInverseSurface;
      final ShapeBorder shape =
          snackBar.shape ??
          barTheme.shape ??
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(12));
      final double elevation = snackBar.elevation ?? barTheme.elevation ?? 6;
      final Clip clipBehavior = snackBar.clipBehavior;
      final EdgeInsetsGeometry padding =
          snackBar.padding ??
          const EdgeInsets.symmetric(horizontal: 16, vertical: 12);

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
                          child: SafeArea(
                            bottom: false,
                            child: Padding(
                              padding: padding,
                              child: _TopSnackBarContent(
                                content: snackBar.content,
                                contentTextStyle:
                                    barTheme.contentTextStyle ??
                                    theme.textTheme.bodyMedium?.copyWith(
                                      color: fgColor,
                                    ),
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

void showAppTopStatusText(
  BuildContext context,
  String text, {
  Duration duration = const Duration(seconds: 2),
}) {
  showAppSnackBar(
    context,
    SnackBar(
      content: Center(child: Text(text, textAlign: TextAlign.center)),
      duration: duration,
      backgroundColor: Colors.transparent,
      elevation: 0,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(0)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
    ),
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
      content: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            color: Colors.green.shade600,
            borderRadius: BorderRadius.circular(999),
            boxShadow: const <BoxShadow>[
              BoxShadow(
                blurRadius: 8,
                offset: Offset(0, 2),
                color: Color(0x26000000),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              const Icon(
                Icons.check_circle_rounded,
                color: Colors.white,
                size: 18,
              ),
              const SizedBox(width: 8),
              Text(
                text,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
      duration: duration,
      backgroundColor: Colors.transparent,
      elevation: 0,
      showCloseIcon: false,
      padding: const EdgeInsets.symmetric(horizontal: 0, vertical: 6),
    ),
  );
}

class _TopSnackBarContent extends StatelessWidget {
  const _TopSnackBarContent({
    required this.content,
    required this.contentTextStyle,
    required this.action,
    required this.showCloseIcon,
    required this.closeIconColor,
    required this.onClose,
  });

  final Widget content;
  final TextStyle? contentTextStyle;
  final SnackBarAction? action;
  final bool showCloseIcon;
  final Color closeIconColor;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final List<Widget> rowChildren = <Widget>[
      Flexible(
        fit: FlexFit.loose,
        child: DefaultTextStyle(
          style: contentTextStyle ?? const TextStyle(),
          child: content,
        ),
      ),
    ];

    if (action != null) {
      rowChildren.add(const SizedBox(width: 8));
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

    return Row(mainAxisSize: MainAxisSize.min, children: rowChildren);
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
