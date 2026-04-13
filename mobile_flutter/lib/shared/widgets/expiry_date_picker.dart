import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/formatting/expiry_display_format.dart';

String _yearPickerTitle(String languageCode) {
  return switch (languageCode) {
    'ru' => 'Год',
    'en' => 'Year',
    _ => 'Yil',
  };
}

/// RN `ExpiryDatePicker` — yil + oy (kun doim 01), `YYYY-MM-DD` qaytarish.
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

  static Future<int?> _pickYear(BuildContext context) async {
    final DateTime now = DateTime.now();
    final int first = 2000;
    final int last = now.year + 10;
    final Locale locale = Localizations.localeOf(context);
    return showDialog<int>(
      context: context,
      builder: (BuildContext ctx) {
        return AlertDialog(
          title: Text(_yearPickerTitle(locale.languageCode)),
          content: SizedBox(
            width: double.maxFinite,
            height: 320,
            child: ListView.builder(
              itemCount: last - first + 1,
              itemBuilder: (BuildContext _, int i) {
                final int year = first + i;
                return ListTile(
                  title: Text('$year'),
                  onTap: () => Navigator.pop(ctx, year),
                );
              },
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(MaterialLocalizations.of(context).cancelButtonLabel),
            ),
          ],
        );
      },
    );
  }

  static Future<int?> _pickMonth(BuildContext context, int year) async {
    final Locale locale = Localizations.localeOf(context);
    final String lang = locale.languageCode;
    return showDialog<int>(
      context: context,
      builder: (BuildContext ctx) {
        return AlertDialog(
          title: Text('$year'),
          content: SizedBox(
            width: double.maxFinite,
            height: 360,
            child: ListView.builder(
              itemCount: 12,
              itemBuilder: (BuildContext _, int i) {
                final int month = i + 1;
                final String labelMonth =
                    DateFormat.MMMM(lang).format(DateTime(year, month, 1));
                return ListTile(
                  title: Text(labelMonth),
                  onTap: () => Navigator.pop(ctx, month),
                );
              },
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(MaterialLocalizations.of(context).cancelButtonLabel),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () async {
        final int? year = await _pickYear(context);
        if (year == null || !context.mounted) {
          return;
        }
        final int? month = await _pickMonth(context, year);
        if (month == null || !context.mounted) {
          return;
        }
        final String s =
            '$year-${month.toString().padLeft(2, '0')}-01';
        onChanged(s);
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
