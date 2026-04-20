import 'package:flutter/material.dart';

/// Shared trailing clear action for text inputs.
Widget? buildInputClearButton({
  required bool visible,
  required VoidCallback onPressed,
  String? tooltip,
  IconData icon = Icons.close,
}) {
  if (!visible) {
    return null;
  }
  return IconButton(
    tooltip: tooltip,
    onPressed: onPressed,
    constraints: const BoxConstraints(
      minWidth: 40,
      minHeight: 40,
    ),
    padding: EdgeInsets.zero,
    splashRadius: 20,
    icon: Icon(icon),
  );
}
