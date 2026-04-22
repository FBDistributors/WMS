import 'package:flutter/material.dart';

class ScanActionButton extends StatelessWidget {
  const ScanActionButton({
    super.key,
    required this.onPressed,
    this.label = 'Skanerlash',
    this.compact = false,
  });

  final VoidCallback? onPressed;
  final String label;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (compact) {
      final ColorScheme scheme = Theme.of(context).colorScheme;
      return Tooltip(
        message: label,
        child: SizedBox(
          width: 56,
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              final double h = constraints.maxHeight.isFinite && constraints.maxHeight > 0
                  ? constraints.maxHeight
                  : 48;
              return Material(
                color: scheme.primary,
                borderRadius: BorderRadius.circular(8),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: onPressed,
                  borderRadius: BorderRadius.circular(8),
                  child: SizedBox(
                    height: h,
                    width: 56,
                    child: Center(
                      child: Icon(
                        Icons.qr_code_scanner,
                        color: scheme.onPrimary,
                        semanticLabel: label,
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      );
    }
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: const Icon(Icons.qr_code_scanner),
      label: Text(label),
    );
  }
}
