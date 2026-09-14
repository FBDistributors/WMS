import 'package:flutter/material.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/formatting/expiry_display_format.dart';
import '../../../l10n/string_lookup.dart';
import '../../picking/data/picking_models.dart' show formatPickQty;
import '../data/dealer_counts_models.dart' show monthStartIso;

/// Diller sanovi — miqdor/muddat kiritish oynasi (noldan sanash va tayyor ro'yxat).
class DealerQtyResult {
  const DealerQtyResult({required this.qty, required this.expiryIso, this.delete = false});
  final double qty;
  final String? expiryIso;
  final bool delete;
}

class DealerQtySheet extends StatefulWidget {
  const DealerQtySheet({
    required this.loc,
    required this.title,
    required this.subtitle,
    required this.initialQty,
    required this.initialExpiry,
    required this.boxUnits,
    required this.allowDelete,
    this.allowZero = false,
  });

  final AppLocale loc;
  final String title;
  final String subtitle;
  /// null — maydon bo'sh ochiladi (yangi skan); tahrirda joriy son.
  final double? initialQty;
  final String? initialExpiry;
  /// Quti kodi skanerlangan bo'lsa — hajm (faqat maslahat tugmasi).
  final int? boxUnits;
  final bool allowDelete;
  /// Tayyor ro'yxatda 0 ham javob ("dillerda yo'q"); noldan sanashda 0 ma'nosiz.
  final bool allowZero;

  @override
  State<DealerQtySheet> createState() => DealerQtySheetState();
}

class DealerQtySheetState extends State<DealerQtySheet> {
  late final TextEditingController _qty;
  String? _expiry;
  bool _canConfirm = false;

  @override
  void initState() {
    super.initState();
    _qty = TextEditingController(
      text: widget.initialQty != null ? formatPickQty(widget.initialQty!) : '',
    );
    _canConfirm = _qty.text.trim().isNotEmpty && (widget.allowZero ? _parsedQty() >= 0 : _parsedQty() > 0);
    _qty.addListener(() {
      final bool ok = _qty.text.trim().isNotEmpty && (widget.allowZero ? _parsedQty() >= 0 : _parsedQty() > 0);
      if (ok != _canConfirm) {
        setState(() => _canConfirm = ok);
      }
    });
    _expiry = widget.initialExpiry;
  }

  double _parsedQty() => double.tryParse(_qty.text.trim().replaceAll(',', '.')) ?? 0;

  @override
  void dispose() {
    _qty.dispose();
    super.dispose();
  }

  Future<void> _pickExpiry() async {
    final DateTime now = DateTime.now();
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: _expiry != null ? (DateTime.tryParse(_expiry!) ?? now) : now,
      firstDate: DateTime(now.year - 3),
      lastDate: DateTime(now.year + 6),
      initialDatePickerMode: DatePickerMode.year,
    );
    if (picked != null) {
      setState(() => _expiry = monthStartIso(picked));
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = widget.loc;
    final ColorScheme cs = Theme.of(context).colorScheme;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            const SizedBox(height: 2),
            Text(widget.subtitle, style: TextStyle(color: cs.onSurfaceVariant, fontFamily: 'monospace', fontSize: 13)),
            const SizedBox(height: 14),
            TextField(
              controller: _qty,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: false),
              decoration: InputDecoration(
                labelText: StringLookup.t(loc, 'dealerCountQtyTitle'),
                hintText: StringLookup.t(loc, 'dealerCountQtyHint'),
                border: const OutlineInputBorder(),
              ),
            ),
            if (widget.boxUnits != null) ...<Widget>[
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: ActionChip(
                  avatar: const Icon(Icons.inventory_2_outlined, size: 16),
                  label: Text(
                    StringLookup.tParams(loc, 'dealerCountBoxHint', <String, String>{'n': '${widget.boxUnits}'}),
                  ),
                  onPressed: () {
                    // Bosilganda: bo'sh bo'lsa hajm qo'yiladi, aks holda hajm qo'shiladi
                    // (2 quti skanerlangan bo'lsa ikki marta bosadi).
                    final double cur = _parsedQty();
                    _qty.text = formatPickQty(cur + widget.boxUnits!);
                  },
                ),
              ),
            ],
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _pickExpiry,
              icon: const Icon(Icons.event_outlined),
              label: Text(
                _expiry != null
                    ? '${StringLookup.t(loc, 'dealerCountExpiryLabel')}: ${formatExpiryMonthYear(_expiry)}'
                    : StringLookup.t(loc, 'dealerCountExpiryLabel'),
              ),
            ),
            if (_expiry != null)
              TextButton(
                onPressed: () => setState(() => _expiry = null),
                child: Text(StringLookup.t(loc, 'cancel')),
              ),
            const SizedBox(height: 12),
            Row(
              children: <Widget>[
                if (widget.allowDelete)
                  TextButton.icon(
                    onPressed: () => Navigator.of(context).pop(const DealerQtyResult(qty: 0, expiryIso: null, delete: true)),
                    icon: const Icon(Icons.delete_outline, color: Colors.red),
                    label: Text(StringLookup.t(loc, 'dealerCountRemoveLine'), style: const TextStyle(color: Colors.red)),
                  ),
                const Spacer(),
                FilledButton(
                  onPressed: !_canConfirm
                      ? null
                      : () {
                          final double q = _parsedQty();
                          if (q < 0 || (!widget.allowZero && q <= 0)) {
                            return;
                          }
                          Navigator.of(context).pop(DealerQtyResult(qty: q, expiryIso: _expiry));
                        },
                  child: Text(StringLookup.t(loc, 'confirmButton')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
