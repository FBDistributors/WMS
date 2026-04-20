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
      final Color borderColor = Theme.of(context).colorScheme.outline;
      return Tooltip(
        message: label,
        child: OutlinedButton(
          onPressed: onPressed,
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(48, 48),
            fixedSize: const Size(48, 48),
            padding: EdgeInsets.zero,
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
            ),
            side: BorderSide(color: borderColor),
          ),
          child: Icon(
            Icons.qr_code_scanner,
            semanticLabel: label,
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
