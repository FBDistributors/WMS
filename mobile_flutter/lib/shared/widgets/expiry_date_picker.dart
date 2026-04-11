import 'package:flutter/material.dart';

import '../../core/formatting/expiry_display_format.dart';

/// RN `ExpiryDatePicker` — sana tanlash + `YYYY-MM-DD` qaytarish.
class ExpiryDatePickerField extends StatelessWidget {
  const ExpiryDatePickerField({
    super.key,
    required this.value,
    required this.onChanged,
    this.label = 'Yaroqlilik muddati',
  });

  final String? value;
  final void Function(String? isoDate) onChanged;
  final String label;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () async {
        final DateTime now = DateTime.now();
        final DateTime? picked = await showDatePicker(
          context: context,
          initialDate: now,
          firstDate: DateTime(2000),
          lastDate: DateTime(now.year + 10),
        );
        if (picked != null) {
          final String s =
              '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
          onChanged(s);
        }
      },
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
        ),
        child: Text(formatExpiryMonthYear(value)),
      ),
    );
  }
}
