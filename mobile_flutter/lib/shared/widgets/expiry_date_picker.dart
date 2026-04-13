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

String _monthPickerTitle(String languageCode) {
  return switch (languageCode) {
    'ru' => 'Месяц',
    'en' => 'Month',
    _ => 'Oy',
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
            height: 340,
            child: GridView.builder(
              padding: const EdgeInsets.all(4),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 4,
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                childAspectRatio: 1.35,
              ),
              itemCount: last - first + 1,
              itemBuilder: (BuildContext _, int i) {
                final int year = first + i;
                return Material(
                  elevation: 1,
                  borderRadius: BorderRadius.circular(8),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: () => Navigator.pop(ctx, year),
                    child: Center(
                      child: Text(
                        '$year',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontWeight: FontWeight.w500),
                      ),
                    ),
                  ),
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
          title: Text('$year · ${_monthPickerTitle(lang)}'),
          content: SizedBox(
            width: double.maxFinite,
            height: 280,
            child: GridView.builder(
              padding: const EdgeInsets.all(4),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                childAspectRatio: 1.5,
              ),
              itemCount: 12,
              itemBuilder: (BuildContext _, int i) {
                final int month = i + 1;
                final String labelMonth =
                    DateFormat.MMM(lang).format(DateTime(year, month, 1));
                return Material(
                  elevation: 1,
                  borderRadius: BorderRadius.circular(8),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: () => Navigator.pop(ctx, month),
                    child: Center(
                      child: Text(
                        labelMonth,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontWeight: FontWeight.w500),
                      ),
                    ),
                  ),
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
        final String s = '$year-${month.toString().padLeft(2, '0')}-01';
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
