import 'package:flutter/material.dart';

class ScanActionButton extends StatelessWidget {
  const ScanActionButton({
    super.key,
    required this.onPressed,
    this.label = 'Skanerlash',
  });

  final VoidCallback onPressed;
  final String label;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: const Icon(Icons.qr_code_scanner),
      label: Text(label),
    );
  }
}
