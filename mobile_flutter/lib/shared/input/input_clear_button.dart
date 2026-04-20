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
    icon: Icon(icon),
  );
}
